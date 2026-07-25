import { BadRequestException } from '@nestjs/common';

// Strefa lokalna firmy. SDD §7 ustala jedną strefę dla całego MVP (produkt krajowy),
// więc stała, a nie zmienna env ani kolumna w Business — helpery zostają czystymi funkcjami.
export const BUSINESS_TIMEZONE = 'Europe/Warsaw';

// siatka slotów z SDD §7
export const SLOT_STEP_MIN = 15;

const MS_PER_MIN = 60_000;

// Grafiki (WorkingHours) trzymają czas lokalny firmy jako "HH:mm", a baza instanty w UTC.
// Cała konwersja między jednym i drugim żyje w tym pliku — bez luxon/date-fns-tz,
// na Intl.DateTimeFormat (pełne ICU jest w runtime).

const partsFormatter = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timeZone: string) => {
  let formatter = partsFormatter.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatter.set(timeZone, formatter);
  }
  return formatter;
};

// Offset strefy (ms) obowiązujący w danym instancie: odczytujemy ścianę zegara w strefie
// i porównujemy z tym samym odczytem potraktowanym jako UTC.
const tzOffsetMs = (instant: Date, timeZone: string): number => {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const at = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    at('year'),
    at('month') - 1,
    at('day'),
    at('hour'),
    at('minute'),
    at('second'),
  );
  // formatToParts gubi milisekundy — instant zaokrąglamy tak samo, żeby został czysty offset
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
};

export interface LocalDate {
  year: number;
  month: number; // 1–12
  day: number;
}

// Kształt "YYYY-MM-DD" sprawdza DTO; tutaj odsiewamy daty nieistniejące w kalendarzu
// (2026-02-30) — round-trip przez Date.UTC ujawnia przewinięcie na kolejny miesiąc.
export const parseLocalDate = (date: string): LocalDate => {
  const [year, month, day] = date.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    throw new BadRequestException('Nieprawidłowa data');
  }
  return { year, month, day };
};

// Odwrotność zonedWallClockToUtc w zakresie samej daty: która doba lokalna obowiązuje
// w tym instancie. Potrzebne przy rezerwacji — z `startsAt` (instant) trzeba wyliczyć
// dzień tygodnia grafiku, a ten jest pojęciem lokalnym firmy.
export const utcToLocalDate = (
  instant: Date,
  timeZone: string = BUSINESS_TIMEZONE,
): LocalDate => {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const at = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return { year: at('year'), month: at('month'), day: at('day') };
};

// Instant UTC dla ściany zegara (data lokalna + "HH:mm") w podanej strefie.
// Dwuprzebiegowo, bo offset zależy od wyniku, którego jeszcze nie znamy: pierwszy strzał
// używa offsetu sprzed zmiany czasu, drugi — offsetu obowiązującego w wyliczonym instancie.
export const zonedWallClockToUtc = (
  { year, month, day }: LocalDate,
  time: string,
  timeZone: string = BUSINESS_TIMEZONE,
): Date => {
  const [hour, minute] = time.split(':').map(Number);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute);

  const firstGuess = wallClockAsUtc - tzOffsetMs(new Date(wallClockAsUtc), timeZone);
  const offset = tzOffsetMs(new Date(firstGuess), timeZone);
  const corrected = wallClockAsUtc - offset;

  return new Date(corrected);
};

// Okno doby lokalnej jako instanty UTC — zakres zapytań o urlopy i rezerwacje.
// W dniu zmiany czasu okno ma poprawnie 23 h / 25 h, bo obie granice liczone są osobno.
export const localDayRangeUtc = (
  date: LocalDate,
  timeZone: string = BUSINESS_TIMEZONE,
): { startUtc: Date; endUtc: Date } => {
  const nextDay = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));
  return {
    startUtc: zonedWallClockToUtc(date, '00:00', timeZone),
    endUtc: zonedWallClockToUtc(
      {
        year: nextDay.getUTCFullYear(),
        month: nextDay.getUTCMonth() + 1,
        day: nextDay.getUTCDate(),
      },
      '00:00',
      timeZone,
    ),
  };
};

// Dzień tygodnia w konwencji Prismy (WorkingHours.weekday: 0 = poniedziałek … 6 = niedziela).
// Liczony z samej daty kalendarzowej przez Date.UTC, więc niezależny od strefy procesu.
export const localWeekday = ({ year, month, day }: LocalDate): number =>
  (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;

export const addMinutes = (instant: Date, minutes: number): Date =>
  new Date(instant.getTime() + minutes * MS_PER_MIN);

// Zaokrąglenie w górę do pełnego kwadransa. Epoka jest wyrównana do :00, a offsety
// Europe/Warsaw są pełnogodzinne, więc siatka w UTC = siatka lokalna.
export const ceilToSlotGrid = (instant: Date): Date => {
  const step = SLOT_STEP_MIN * MS_PER_MIN;
  return new Date(Math.ceil(instant.getTime() / step) * step);
};

// Czy instant leży dokładnie na siatce slotów. Odsiewa też niezerowe sekundy i milisekundy,
// bo te przesuwają czas względem pełnego kwadransa.
export const isOnSlotGrid = (instant: Date): boolean =>
  instant.getTime() % (SLOT_STEP_MIN * MS_PER_MIN) === 0;
