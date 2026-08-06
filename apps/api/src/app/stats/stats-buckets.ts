import { BookingStatus } from '@prisma/client';

/**
 * Czysta warstwa dashboardu (#56): kubełki osi czasu i przeliczenia, których SQL nie odda.
 * Agregaty liczy baza (`GROUP BY`), ale grupowanie zwraca wyłącznie niepuste pary
 * (kubełek, status) — dzień bez rezerwacji nie ma w ogóle wiersza. Front rysuje ciągłą oś,
 * więc dziury domykamy tutaj, tym samym wzorem co `reviews/rating-distribution.ts`.
 */

export type StatsGranularity = 'day' | 'week';

/** Powyżej tego progu oś dzienna robi się nieczytelna i przechodzimy na kubełki tygodniowe. */
export const DAY_GRANULARITY_MAX_DAYS = 31;

/** Dłuższych zakresów nie obsługujemy — generate_series w SQL-u obłożenia rośnie liniowo. */
export const MAX_RANGE_DAYS = 366;

export type StatusCounts = Record<BookingStatus, number>;

export interface SeriesBucket {
  /** Początek kubełka jako data lokalna firmy „YYYY-MM-DD" (dla tygodnia — poniedziałek). */
  bucket: string;
  total: number;
  byStatus: StatusCounts;
}

/** Wiersz z `GROUP BY bucket, status` — po stronie SQL-a `COUNT(*)::int`. */
export interface StatusBucketRow {
  bucket: string;
  status: BookingStatus;
  count: number;
}

const MS_PER_DAY = 86_400_000;

/** „YYYY-MM-DD" → północ UTC. Daty kalendarzowe, nigdy `new Date(str)` zależne od strefy procesu. */
const toUtcMidnight = (date: string): number => {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
};

const toIsoDate = (utcMs: number): string => new Date(utcMs).toISOString().slice(0, 10);

/** Liczba dni kalendarzowych w zakresie, obie granice włącznie (from = to → 1). */
export const rangeDays = (from: string, to: string): number =>
  Math.round((toUtcMidnight(to) - toUtcMidnight(from)) / MS_PER_DAY) + 1;

export const granularityFor = (from: string, to: string): StatsGranularity =>
  rangeDays(from, to) <= DAY_GRANULARITY_MAX_DAYS ? 'day' : 'week';

/** Poniedziałek tygodnia zawierającego datę — konwencja tygodnia zgodna z `date_trunc('week')`. */
const startOfWeek = (utcMs: number): number => {
  const weekday = (new Date(utcMs).getUTCDay() + 6) % 7; // 0 = poniedziałek
  return utcMs - weekday * MS_PER_DAY;
};

/**
 * Klucze wszystkich kubełków zakresu, rosnąco. Dla tygodni pierwszy kubełek zaczyna się
 * poniedziałkiem sprzed `from` — tak samo jak `date_trunc('week')` w zapytaniu, więc wiersze
 * z bazy zawsze trafiają w istniejący klucz.
 */
export const bucketKeys = (
  from: string,
  to: string,
  granularity: StatsGranularity,
): string[] => {
  const step = granularity === 'day' ? MS_PER_DAY : 7 * MS_PER_DAY;
  const start = granularity === 'day' ? toUtcMidnight(from) : startOfWeek(toUtcMidnight(from));
  const end = toUtcMidnight(to);

  const keys: string[] = [];
  for (let ms = start; ms <= end; ms += step) {
    keys.push(toIsoDate(ms));
  }
  return keys;
};

const emptyStatusCounts = (): StatusCounts =>
  Object.fromEntries(
    Object.values(BookingStatus).map((status) => [status, 0]),
  ) as StatusCounts;

/**
 * Wiersze z bazy rozłożone na pełną oś kubełków. Świeże obiekty na każde wywołanie (wynik
 * idzie prosto do odpowiedzi HTTP), zera dla brakujących par, `total` liczone z rozkładu —
 * dzięki temu suma słupków zawsze zgadza się z wysokością kubełka.
 */
export const fillSeries = (rows: StatusBucketRow[], keys: string[]): SeriesBucket[] => {
  const byKey = new Map(
    keys.map((bucket) => [bucket, { bucket, total: 0, byStatus: emptyStatusCounts() }]),
  );

  for (const row of rows) {
    const entry = byKey.get(row.bucket);
    // wiersz spoza osi nie może dorobić kubełka na końcu wykresu — przy poprawnym zakresie
    // nie ma prawa wystąpić, ale zakres liczą dwa niezależne miejsca (SQL i bucketKeys)
    if (entry) {
      entry.byStatus[row.status] += row.count;
      entry.total += row.count;
    }
  }

  return keys.map((key) => byKey.get(key) as SeriesBucket);
};

/** Sumy per status z tych samych wierszy co seria — bez drugiego zapytania i bez rozjazdu. */
export const sumByStatus = (rows: StatusBucketRow[]): StatusCounts => {
  const totals = emptyStatusCounts();
  for (const row of rows) {
    totals[row.status] += row.count;
  }
  return totals;
};

export const countAll = (totals: StatusCounts): number =>
  Object.values(totals).reduce((sum, count) => sum + count, 0);

/**
 * Procent obłożenia. `null`, nie `0`, gdy pracownik nie ma w zakresie ani minuty grafiku —
 * „0 %" sugerowałoby wolne terminy, których nie ma; front pokazuje wtedy „brak grafiku".
 * Wyniku nie przycinamy do 100 %: rezerwacja poza grafikiem to realny sygnał, nie błąd
 * liczenia (przycięcie długości paska jest sprawą widoku).
 */
export const occupancyPercent = (
  bookedMinutes: number,
  capacityMinutes: number,
): number | null =>
  capacityMinutes > 0 ? Math.round((bookedMinutes / capacityMinutes) * 100) : null;
