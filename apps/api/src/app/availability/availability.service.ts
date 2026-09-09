import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { publicBusinessWhere } from '../businesses/public-business';
import { PrismaService } from '../prisma/prisma.service';
import {
  LocalDate,
  addLocalDays,
  formatLocalDate,
  localDayRangeUtc,
  countLocalDays,
  localWeekday,
  parseLocalDate,
  zonedWallClockToUtc,
} from './business-time';
import { AvailabilityQueryDto } from './dto/availability-query.dto';
import { FirstSlotsQueryDto } from './dto/first-slots-query.dto';
import {
  BLOCKING_STATUSES,
  BusyInterval,
  WorkInterval,
  generateSlots,
} from './slots.util';

export interface AvailableSlot {
  employeeId: string;
  startsAt: string; // ISO 8601, UTC
}

/** Najwcześniejszy wolny termin jednego dnia — po jednym na dzień, dla dni, w których coś jest. */
export interface FirstSlot {
  date: string; // "YYYY-MM-DD", data lokalna firmy
  startsAt: string; // ISO 8601, UTC
  employeeId: string;
}

/**
 * Ile dni naraz wolno objąć jednym pytaniem o pierwsze wolne terminy. Bez limitu żądanie
 * o rok kazałoby wygenerować sloty dla 365 dni razy liczba pracowników — koszt liniowy
 * po parametrze, który przychodzi z zewnątrz.
 */
const MAX_RANGE_DAYS = 31;

/** Usługa rozwiązana ze slugu firmy: czas trwania i pracownicy, którzy ją wykonują. */
interface ResolvedService {
  durationMin: number;
  employeeIds: string[];
}

/** Wejście przeglądu jednego dnia: kogo, jak długo i z czym w tle liczymy. */
interface DayScan {
  date: LocalDate;
  employeeIds: string[];
  durationMin: number;
  /** Grafik wszystkich pracowników, wszystkie dni tygodnia — dobę odsiewa `earliestSlotOfDay`. */
  workingHours: EmployeeWorkingHours[];
  /** Urlopy i rezerwacje z całego pytanego zakresu, przycinane do doby na miejscu. */
  busyInRange: EmployeeBusy[];
  now: Date;
}

/** Wiersz grafiku z bazy — czasy jako lokalne "HH:mm" firmy, nie instanty. */
interface EmployeeWorkingHours {
  employeeId: string;
  weekday: number;
  startTime: string;
  endTime: string;
}

/** Urlop albo blokująca rezerwacja, z pracownikiem, którego zajmuje. */
type EmployeeBusy = BusyInterval & { employeeId: string };

// Grafik danego dnia przeliczony na instanty UTC. Wspólne dla obu tras dostępności: godziny
// w bazie są ścianą zegara firmy, a generator slotów kroczy realnym czasem.
const workIntervals = (
  date: LocalDate,
  hours: { startTime: string; endTime: string }[],
): WorkInterval[] =>
  hours.map((wh) => ({
    startUtc: zonedWallClockToUtc(date, wh.startTime),
    endUtc: zonedWallClockToUtc(date, wh.endTime),
  }));

@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Firma → usługa → pracownicy, z kodami błędów wspólnymi dla obu tras dostępności:
   * firma niepubliczna i usługa spoza niej dają 404 nieodróżnialne od nieistniejących,
   * a podany `employeeId`, który tej usługi nie wykonuje, też 404.
   *
   * `employeeIds: []` znaczy „usługa bez przypisanych pracowników" — nie błąd, po prostu
   * brak terminów. Ten przypadek jest możliwy tylko bez `employeeId` w query.
   */
  private async resolveService(
    slug: string,
    query: { serviceId: string; employeeId?: string },
  ): Promise<ResolvedService> {
    // warunek „firma działa" w WHERE, nie po fetchu → firma niedziałająca i nieistniejąca
    // dają identyczne 404 (tak jak BusinessesService.findBySlug)
    const business = await this.prisma.business.findFirst({
      where: { slug, ...publicBusinessWhere },
      select: { id: true },
    });
    if (!business) {
      throw new NotFoundException('Nie znaleziono firmy');
    }

    // jedno zapytanie: usługa w tej firmie + aktywni pracownicy, którzy ją wykonują
    // (zawężeni do employeeId, jeśli podany)
    const service = await this.prisma.service.findFirst({
      where: { id: query.serviceId, businessId: business.id, isActive: true },
      select: {
        durationMin: true,
        employees: {
          where: { isActive: true, ...(query.employeeId && { id: query.employeeId }) },
          select: { id: true },
        },
      },
    });
    if (!service) {
      throw new NotFoundException('Nie znaleziono usługi');
    }

    const employeeIds = service.employees.map((e) => e.id);
    // podany pracownik nie wykonuje tej usługi / jest nieaktywny → 404;
    // bez employeeId to po prostu usługa bez przypisanych pracowników → brak slotów
    if (employeeIds.length === 0 && query.employeeId) {
      throw new NotFoundException('Nie znaleziono pracownika');
    }

    return { durationMin: service.durationMin, employeeIds };
  }

  async getSlots(slug: string, query: AvailabilityQueryDto): Promise<AvailableSlot[]> {
    const date = parseLocalDate(query.date);
    const { durationMin, employeeIds } = await this.resolveService(slug, query);
    if (employeeIds.length === 0) {
      return [];
    }

    const weekday = localWeekday(date);
    const { startUtc, endUtc } = localDayRangeUtc(date);

    // trzy zapytania dla wszystkich pracowników naraz (employeeId: { in }), nie w pętli.
    // Urlopy i rezerwacje po warunku nachodzenia na dobę, a nie „startsAt w dobie” —
    // łapie też przedział rozpoczęty poprzedniego dnia i wchodzący w ten.
    const [workingHours, timeOffs, bookings] = await Promise.all([
      this.prisma.workingHours.findMany({
        where: { employeeId: { in: employeeIds }, weekday },
        select: { employeeId: true, startTime: true, endTime: true },
      }),
      this.prisma.timeOff.findMany({
        where: {
          employeeId: { in: employeeIds },
          startsAt: { lt: endUtc },
          endsAt: { gt: startUtc },
        },
        select: { employeeId: true, startsAt: true, endsAt: true },
      }),
      this.prisma.booking.findMany({
        where: {
          employeeId: { in: employeeIds },
          status: { in: BLOCKING_STATUSES },
          startsAt: { lt: endUtc },
          endsAt: { gt: startUtc },
        },
        select: { employeeId: true, startsAt: true, endsAt: true },
      }),
    ]);

    const now = new Date();
    const slots = employeeIds.flatMap((employeeId) => {
      const intervals = workIntervals(
        date,
        workingHours.filter((wh) => wh.employeeId === employeeId),
      );

      const busy: BusyInterval[] = [...timeOffs, ...bookings].filter(
        (b) => b.employeeId === employeeId,
      );

      return generateSlots({
        intervals,
        busy,
        durationMin,
        notBefore: now,
      }).map((startsAt) => ({ employeeId, startsAt }));
    });

    return slots
      .sort(
        (a, b) =>
          a.startsAt.getTime() - b.startsAt.getTime() ||
          a.employeeId.localeCompare(b.employeeId),
      )
      .map(({ employeeId, startsAt }) => ({
        employeeId,
        startsAt: startsAt.toISOString(),
      }));
  }

  /**
   * Po jednym najwcześniejszym slocie na dzień, dla dni z czymkolwiek wolnym (#191). Kreator
   * bierze pierwszy element i ma z niego naraz dzień do ustawienia i godzinę do wybrania.
   *
   * Osobna metoda, nie tryb `getSlots`: różnica („wszystkie sloty jednego dnia" wobec „jeden
   * slot na dzień") jest w kształcie odpowiedzi, więc należy do nazwy trasy, a nie do query
   * paramu. Wspólne z `getSlots` zostaje w `resolveService` — te same 404 i ten sam zestaw
   * pracowników.
   *
   * Dane bierzemy trzema zapytaniami na cały zakres, nie po jednym na dzień: grafik ma
   * najwyżej 7 wierszy na pracownika, a urlopy i rezerwacje filtrujemy w pamięci po dobie.
   */
  async getFirstSlots(slug: string, query: FirstSlotsQueryDto): Promise<FirstSlot[]> {
    const from = parseLocalDate(query.from);
    const to = parseLocalDate(query.to);

    const days = countLocalDays(from, to);
    if (days <= 0) {
      throw new BadRequestException('to nie może być wcześniejsze niż from');
    }
    if (days > MAX_RANGE_DAYS) {
      throw new BadRequestException(`Zakres nie może przekraczać ${MAX_RANGE_DAYS} dni`);
    }

    const { durationMin, employeeIds } = await this.resolveService(slug, query);
    if (employeeIds.length === 0) {
      return [];
    }

    const rangeStartUtc = localDayRangeUtc(from).startUtc;
    const rangeEndUtc = localDayRangeUtc(to).endUtc;

    // Grafik bez zawężenia po weekday — zakres obejmuje zwykle cały tydzień, a wierszy
    // na pracownika jest najwyżej siedem; dzień tygodnia odsiewamy niżej, w pętli po dniach.
    const [workingHours, timeOffs, bookings] = await Promise.all([
      this.prisma.workingHours.findMany({
        where: { employeeId: { in: employeeIds } },
        select: { employeeId: true, weekday: true, startTime: true, endTime: true },
      }),
      this.prisma.timeOff.findMany({
        where: {
          employeeId: { in: employeeIds },
          startsAt: { lt: rangeEndUtc },
          endsAt: { gt: rangeStartUtc },
        },
        select: { employeeId: true, startsAt: true, endsAt: true },
      }),
      this.prisma.booking.findMany({
        where: {
          employeeId: { in: employeeIds },
          status: { in: BLOCKING_STATUSES },
          startsAt: { lt: rangeEndUtc },
          endsAt: { gt: rangeStartUtc },
        },
        select: { employeeId: true, startsAt: true, endsAt: true },
      }),
    ]);

    const busyInRange: EmployeeBusy[] = [...timeOffs, ...bookings];
    const now = new Date();
    const result: FirstSlot[] = [];

    for (let offset = 0; offset < days; offset++) {
      const date = addLocalDays(from, offset);
      const earliest = this.earliestSlotOfDay({
        date,
        employeeIds,
        durationMin,
        workingHours,
        busyInRange,
        now,
      });
      // dzień poza grafikiem, zajęty urlopem albo zapchany rezerwacjami po prostu wypada
      // z odpowiedzi — kreator dostaje wyłącznie dni, w które da się umówić
      if (earliest) {
        result.push({
          date: formatLocalDate(date),
          startsAt: earliest.startsAt.toISOString(),
          employeeId: earliest.employeeId,
        });
      }
    }

    return result;
  }

  /**
   * Najwcześniejszy slot jednego dnia spośród wszystkich pracowników, albo `null`.
   * Każdy pracownik liczy tylko swój pierwszy slot (`limit: 1`), więc dzień kosztuje
   * jedno przejście po grafiku, nie całą jego siatkę.
   *
   * Remis rozstrzyga `employeeId` — ten sam porządek co w `getSlots`, żeby „pierwszy wolny"
   * nie skakał między pracownikami przy dwóch identycznych terminach.
   */
  private earliestSlotOfDay({
    date,
    employeeIds,
    durationMin,
    workingHours,
    busyInRange,
    now,
  }: DayScan): { startsAt: Date; employeeId: string } | null {
    const weekday = localWeekday(date);
    const { startUtc, endUtc } = localDayRangeUtc(date);

    let best: { startsAt: Date; employeeId: string } | null = null;

    for (const employeeId of employeeIds) {
      const intervals = workIntervals(
        date,
        workingHours.filter(
          (wh) => wh.employeeId === employeeId && wh.weekday === weekday,
        ),
      );

      // zajętości pobrane na cały zakres przycinamy do tej doby
      const busy = busyInRange.filter(
        (b) => b.employeeId === employeeId && b.startsAt < endUtc && b.endsAt > startUtc,
      );

      const [startsAt] = generateSlots({
        intervals,
        busy,
        durationMin,
        notBefore: now,
        limit: 1,
      });
      if (!startsAt) {
        continue;
      }

      if (
        !best ||
        startsAt < best.startsAt ||
        (startsAt.getTime() === best.startsAt.getTime() &&
          employeeId.localeCompare(best.employeeId) < 0)
      ) {
        best = { startsAt, employeeId };
      }
    }

    return best;
  }
}
