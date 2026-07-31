import {
  LocalDate,
  addMinutes,
  isOnSlotGrid,
  localWeekday,
  utcToLocalDate,
  zonedWallClockToUtc,
} from '../../src/app/availability/business-time';
import {
  BusyInterval,
  WorkInterval,
  fitsAnyInterval,
  overlapsAny,
} from '../../src/app/availability/slots.util';
import {
  DEMO_BOOKINGS,
  DEMO_BUSINESSES,
  DEMO_TIME_OFFS,
  DemoBookingSpec,
  DemoEmployee,
  DemoTimeOffSpec,
} from './demo-data';

/**
 * Zamiana opisu rezerwacji z `demo-data.ts` (przesunięcie w dniach roboczych + godzina lokalna)
 * na konkretne instanty UTC. Czysta funkcja `now → rekordy`, więc daje się przetestować bez bazy.
 *
 * Cała arytmetyka stref idzie przez helpery availability (`business-time.ts`) — seed nie ma
 * własnej wersji przeliczania „HH:mm w Europe/Warsaw” na instant, bo dwie implementacje tego
 * samego rozjechałyby się przy zmianie czasu.
 */

// Ile dni kalendarzowych przeszukujemy, zanim uznamy, że dane demo są niespójne. Najrzadszy
// grafik w zestawie to 3 dni w tygodniu, a największe przesunięcie to 9 dni roboczych.
const MAX_DAY_SCAN = 120;

export interface PlannedBooking {
  spec: DemoBookingSpec;
  durationMin: number;
  startsAt: Date;
  endsAt: Date;
}

export interface PlannedTimeOff {
  spec: DemoTimeOffSpec;
  startsAt: Date;
  endsAt: Date;
}

const findBusiness = (slug: string) => {
  const business = DEMO_BUSINESSES.find((b) => b.slug === slug);
  if (!business) {
    throw new Error(`Dane demo: nie ma firmy o slugu "${slug}"`);
  }
  return business;
};

const findEmployee = (businessSlug: string, name: string) => {
  const employee = findBusiness(businessSlug).employees.find(
    (e) => e.name === name,
  );
  if (!employee) {
    throw new Error(
      `Dane demo: firma "${businessSlug}" nie ma pracownika "${name}"`,
    );
  }
  return employee;
};

const findService = (businessSlug: string, name: string) => {
  const service = findBusiness(businessSlug).services.find(
    (s) => s.name === name,
  );
  if (!service) {
    throw new Error(
      `Dane demo: firma "${businessSlug}" nie ma usługi "${name}"`,
    );
  }
  return service;
};

/** Data lokalna przesunięta o `days` dób kalendarzowych — przez Date.UTC, więc bez DST-owych pułapek. */
const addLocalDays = (
  { year, month, day }: LocalDate,
  days: number,
): LocalDate => {
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
};

/** Przedziały pracy pracownika w danej dobie lokalnej, już jako instanty UTC. */
export const workIntervalsFor = (
  employee: DemoEmployee,
  date: LocalDate,
): WorkInterval[] => {
  const weekday = localWeekday(date);
  return employee.workingHours
    .filter((wh) => wh.weekday === weekday)
    .map((wh) => ({
      startUtc: zonedWallClockToUtc(date, wh.startTime),
      endUtc: zonedWallClockToUtc(date, wh.endTime),
    }));
};

/**
 * Data `offset`-tej doby, w której pracownik pracuje i spełniony jest dodatkowy warunek.
 * Dodatnie przesunięcia liczymy od jutra, ujemne od wczoraj — dzięki temu przeszłe pozycje
 * zawsze leżą przed `now`, a przyszłe po nim, bez względu na porę uruchomienia seeda.
 */
const nthWorkdayMatching = (
  today: LocalDate,
  offset: number,
  employee: DemoEmployee,
  matches: (date: LocalDate, intervals: WorkInterval[]) => boolean,
  what: string,
): LocalDate => {
  if (offset === 0) {
    throw new Error(
      'Dane demo: przesunięcie 0 jest niedozwolone (dziś bywa już po godzinach)',
    );
  }

  const step = Math.sign(offset);
  let found = 0;

  for (
    let dayShift = step;
    Math.abs(dayShift) <= MAX_DAY_SCAN;
    dayShift += step
  ) {
    const date = addLocalDays(today, dayShift);
    const intervals = workIntervalsFor(employee, date);

    if (intervals.length === 0 || !matches(date, intervals)) {
      continue;
    }

    found += 1;
    if (found === Math.abs(offset)) {
      return date;
    }
  }

  throw new Error(
    `Dane demo: nie znalazłem ${Math.abs(offset)}. dnia roboczego pracownika ` +
      `"${employee.name}" ${what} w oknie ${MAX_DAY_SCAN} dni`,
  );
};

/**
 * Data `offset`-tego dnia roboczego, w którym wizyta mieści się w grafiku i nie wpada na urlop.
 * Urlopy sprawdzamy już tutaj, a nie dopiero przy walidacji: inaczej wydłużenie urlopu albo
 * przesunięcie wizyty dalej w przyszłość wywalałoby seed tylko przy części dni startowych.
 */
const nthFittingWorkday = (
  today: LocalDate,
  offset: number,
  employee: DemoEmployee,
  startTime: string,
  durationMin: number,
  busy: BusyInterval[],
): LocalDate =>
  nthWorkdayMatching(
    today,
    offset,
    employee,
    (date, intervals) => {
      const start = zonedWallClockToUtc(date, startTime);
      const end = addMinutes(start, durationMin);
      return (
        fitsAnyInterval(start, end, intervals) && !overlapsAny(start, end, busy)
      );
    },
    `z wolnym terminem ${startTime} (${durationMin} min)`,
  );

/**
 * Urlopy demo. Liczone w dniach roboczych pracownika, więc zawsze wycinają z kalendarza
 * dokładnie tyle dni pracy, ile deklaruje `workdays` — weekend, który wypadnie pomiędzy,
 * wchodzi w zakres tak samo jak przy prawdziwym urlopie.
 */
export const planDemoTimeOffs = (now: Date): PlannedTimeOff[] => {
  const today = utcToLocalDate(now);
  const anyWorkday = () => true;

  return DEMO_TIME_OFFS.map((spec) => {
    const employee = findEmployee(spec.businessSlug, spec.employeeName);
    const first = nthWorkdayMatching(
      today,
      spec.startWorkdayOffset,
      employee,
      anyWorkday,
      'z grafikiem',
    );
    const last = nthWorkdayMatching(
      today,
      spec.startWorkdayOffset + spec.workdays - 1,
      employee,
      anyWorkday,
      'z grafikiem',
    );

    return {
      spec,
      startsAt: zonedWallClockToUtc(first, '00:00'),
      endsAt: zonedWallClockToUtc(addLocalDays(last, 1), '00:00'),
    };
  });
};

/**
 * Rezerwacje demo przeliczone na instanty. Poza terminami pilnuje tego, czego przy ręcznym
 * wpisywaniu dat łatwo nie zauważyć, a co psuje kalendarz i availability: siatki 15 minut,
 * mieszczenia się w grafiku i kolizji z innymi rezerwacjami tego samego pracownika oraz
 * z jego urlopami. Niespójne dane wywalają seed od razu, zamiast po cichu wygenerować
 * nakładające się wizyty.
 */
export const planDemoBookings = (now: Date): PlannedBooking[] => {
  const today = utcToLocalDate(now);
  const busyByEmployee = new Map<string, BusyInterval[]>();

  // urlopy są w tej mapie od początku, więc wybór dnia wizyty od razu je omija
  for (const timeOff of planDemoTimeOffs(now)) {
    const key = `${timeOff.spec.businessSlug}/${timeOff.spec.employeeName}`;
    busyByEmployee.set(key, [
      ...(busyByEmployee.get(key) ?? []),
      { startsAt: timeOff.startsAt, endsAt: timeOff.endsAt },
    ]);
  }

  const planned: PlannedBooking[] = [];

  for (const spec of DEMO_BOOKINGS) {
    const employee = findEmployee(spec.businessSlug, spec.employeeName);
    const service = findService(spec.businessSlug, spec.serviceName);

    if (!service.employeeNames.includes(spec.employeeName)) {
      throw new Error(
        `Dane demo: usługa "${spec.serviceName}" nie jest przypisana do "${spec.employeeName}"`,
      );
    }

    const key = `${spec.businessSlug}/${spec.employeeName}`;
    const busy = busyByEmployee.get(key) ?? [];

    const date = nthFittingWorkday(
      today,
      spec.workdayOffset,
      employee,
      spec.startTime,
      service.durationMin,
      busy,
    );
    const startsAt = zonedWallClockToUtc(date, spec.startTime);
    const endsAt = addMinutes(startsAt, service.durationMin);

    if (!isOnSlotGrid(startsAt)) {
      throw new Error(
        `Dane demo: ${spec.startTime} w firmie "${spec.businessSlug}" nie leży na siatce 15 minut`,
      );
    }

    if (overlapsAny(startsAt, endsAt, busy)) {
      throw new Error(
        `Dane demo: rezerwacja ${spec.serviceName} u "${spec.employeeName}" ` +
          `(${startsAt.toISOString()}) koliduje z inną pozycją tego pracownika`,
      );
    }

    busyByEmployee.set(key, [...busy, { startsAt, endsAt }]);
    planned.push({ spec, durationMin: service.durationMin, startsAt, endsAt });
  }

  return planned;
};
