import { addLocalDays, todayInBusinessTz } from '../shared/business-time';

/** Ten sam sentinel „dowolny pracownik", którym posługuje się kreator rezerwacji. */
const ANY_EMPLOYEE = 'any';

/** Tydzień to jednostka, w której odkłada się każdy wynik cofnięty do przeszłości. */
const WEEK_DAYS = 7;

/** Tyle minionej wizyty, ile trzeba, żeby zbudować z niej link ponownej rezerwacji. */
export interface RebookSource {
  startsAt: string;
  status: string;
  service: { id: string };
  rebookEmployeeId: string | null;
}

/** Query params linku „Zarezerwuj ponownie" — `rebookEmployeeGone` tylko wtedy, gdy padło. */
export interface RebookQueryParams {
  serviceId: string;
  employeeId: string;
  rebookFrom: string;
  rebookEmployeeGone?: '1';
}

/** 31 stycznia + miesiąc to 28 lutego, nie 3 marca — natywne przesunięcie miesiąca w `Date`
 *  przelewa nadmiarowe dni do kolejnego miesiąca, więc dzień przycinamy do długości celu. */
const addMonth = (date: string): string => {
  const [year, month, day] = date.split('-').map(Number);
  const lastDayOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDayOfTarget)))
    .toISOString()
    .slice(0, 10);
};

/**
 * Punkt startowy szukania terminu (`YYYY-MM-DD` w strefie firmy) — moment, w którym klient
 * prawdopodobnie znów zechce przyjść. Reguła siedzi na froncie świadomie: ADR-0005.
 *
 * Miesiąc po wizycie zakończonej, tydzień po odwołanej, a przy odwołaniu terminu, który
 * jeszcze nie minął — od dziś, bo to przekładanie wizyty, nie kolejny cykl. Wynik cofnięty
 * do przeszłości (stara wizyta z archiwum) odkładamy o tydzień od dziś: kreator i tak nie
 * pokaże wolnych terminów wstecz.
 */
export function rebookFrom(booking: RebookSource, now = new Date()): string {
  const startsAt = new Date(booking.startsAt);
  const today = todayInBusinessTz(now);
  const visitDate = todayInBusinessTz(startsAt);
  const stillAhead = startsAt.getTime() > now.getTime();

  const suggested =
    booking.status === 'COMPLETED'
      ? addMonth(visitDate)
      : stillAhead
        ? today
        : addLocalDays(visitDate, WEEK_DAYS);

  // porównanie leksykalne wystarcza: YYYY-MM-DD sortuje się chronologicznie
  return suggested < today ? addLocalDays(today, WEEK_DAYS) : suggested;
}

/**
 * Query params kreatora dla ponownej rezerwacji.
 *
 * `clientNote` nie jedzie z wizytą: notatka („spóźnię się 5 minut") to jednorazowy kontekst,
 * który w nowym terminie staje się nieprawdą, a firma przeczyta ją jako aktualną.
 */
export function rebookQueryParams(
  booking: RebookSource,
  now = new Date(),
): RebookQueryParams {
  const employeeGone = booking.rebookEmployeeId === null;

  return {
    serviceId: booking.service.id,
    employeeId: booking.rebookEmployeeId ?? ANY_EMPLOYEE,
    rebookFrom: rebookFrom(booking, now),
    // bez tej flagi kreator nie odróżni „klient sam wybrał dowolnego pracownika"
    // od „zdegradowaliśmy wybór, bo tej osoby już nie ma"
    ...(employeeGone ? { rebookEmployeeGone: '1' as const } : {}),
  };
}
