import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { BookingStatus, Prisma } from '@prisma/client';
import {
  addMinutes,
  isOnSlotGrid,
  localWeekday,
  utcToLocalDate,
  zonedWallClockToUtc,
} from '../availability/business-time';
import {
  BLOCKING_STATUSES,
  WorkInterval,
  fitsAnyInterval,
  overlapsAny,
} from '../availability/slots.util';
import { PrismaService } from '../prisma/prisma.service';
import { BookingEventsService } from './booking-events.service';
import { STATUS_LABELS, canTransition } from './booking-status';
import { CreateBookingDto } from './dto/create-booking.dto';

// Namespace advisory locków tego modułu — pierwszy argument pg_advisory_xact_lock(int, int).
// Stała, żeby klucz z hashtext(employeeId) nie zderzył się z blokadami innego kawałka systemu.
const BOOKING_LOCK_NAMESPACE = 1;

// kształt rezerwacji zwracany z POST /bookings i z decyzji firmy (confirm/decline)
const bookingSelect = {
  id: true,
  businessId: true,
  employeeId: true,
  serviceId: true,
  startsAt: true,
  endsAt: true,
  status: true,
  clientNote: true,
} satisfies Prisma.BookingSelect;

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: BookingEventsService,
  ) {}

  // decyzje firmy — dwa wejścia do tej samej maszyny stanów (SDD §7)
  confirm(userId: string, bookingId: string) {
    return this.transition(userId, bookingId, BookingStatus.CONFIRMED);
  }

  decline(userId: string, bookingId: string) {
    return this.transition(userId, bookingId, BookingStatus.DECLINED);
  }

  /**
   * Przejście statusu pojedynczej rezerwacji na żądanie użytkownika — tędy wejdzie #27
   * (odwołania klienta i firmy). Cron auto-COMPLETED z #39 potrzebuje operacji masowej
   * („jeden update, nie pętla per rekord"), więc nie użyje tej metody — reguły przejść
   * bierze wprost z ALLOWED_TRANSITIONS w booking-status.ts.
   *
   * Kolejność jest istotna: cokolwiek odpadnie na walidacji, odpada przed jedynym zapisem,
   * więc nieprawidłowe przejście nie zostawia po sobie żadnej zmiany (AC #26).
   */
  private async transition(userId: string, bookingId: string, to: BookingStatus) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { status: true, business: { select: { ownerId: true } } },
    });
    if (!booking) {
      throw new NotFoundException('Nie znaleziono rezerwacji');
    }
    // Cudza rezerwacja to 403, nie 404 — AC wprost tego wymaga, więc świadomie
    // odchodzimy od „cudze = 404" z ServicesService.
    if (booking.business.ownerId !== userId) {
      throw new ForbiddenException('Brak uprawnień');
    }
    const from = booking.status;
    if (!canTransition(from, to)) {
      throw new ConflictException(
        `Rezerwacja jest ${STATUS_LABELS[from]} — nie można zmienić jej statusu`,
      );
    }

    // status w WHERE zamyka wyścig między odczytem a zapisem: gdy ktoś w międzyczasie
    // ruszył rezerwację, warunek nie trafia i Prisma rzuca P2025 zamiast nadpisać cudzą
    // decyzję (where w update przyjmuje też pola nieunikalne obok klucza).
    const updated = await this.prisma.booking
      .update({
        where: { id: bookingId, status: from },
        data: { status: to },
        select: bookingSelect,
      })
      .catch((e: unknown) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
          throw new ConflictException('Status rezerwacji zmienił się w międzyczasie');
        }
        throw e;
      });

    // Dopiero po zatwierdzonym zapisie — punkt zaczepienia dla maili z M7 (#37).
    // Powiadomienie jest efektem ubocznym, nie częścią operacji: rezerwacja jest już
    // zmieniona, więc padnięta wysyłka ma trafić do logu, a nie zamienić 200 w 500
    // (AC #37: „błąd wysyłki nie wywala operacji na rezerwacji").
    try {
      this.events.statusChanged(updated, from, to);
    } catch (e) {
      this.logger.error(
        `Nie udało się obsłużyć zdarzenia dla rezerwacji ${updated.id}`,
        e instanceof Error ? e.stack : String(e),
      );
    }
    return updated;
  }

  async create(userId: string, dto: CreateBookingDto) {
    const startsAt = new Date(dto.startsAt);

    // Warunki na sam czas — przed bazą, tak jak parseLocalDate w AvailabilityService.
    // /availability wystawia wyłącznie starty z siatki 15 min, więc cokolwiek innego
    // to ręcznie sklejony request, nie zniknięty slot → 400, nie 409.
    if (!isOnSlotGrid(startsAt)) {
      throw new BadRequestException('startsAt musi być wielokrotnością 15 minut');
    }
    if (startsAt <= new Date()) {
      throw new BadRequestException('startsAt musi być w przyszłości');
    }

    // Jedno zapytanie na cały scope: usługa aktywna, firma niezablokowana, a w środku
    // pracownik — aktywny i przypisany do tej usługi. Firma po relacji, nie po fetchu,
    // więc zablokowana i nieistniejąca dają identyczne 404 (jak w AvailabilityService).
    const service = await this.prisma.service.findFirst({
      where: { id: dto.serviceId, isActive: true, business: { isBlocked: false } },
      select: {
        businessId: true,
        durationMin: true,
        employees: {
          where: { id: dto.employeeId, isActive: true },
          select: { id: true },
        },
      },
    });
    if (!service) {
      throw new NotFoundException('Nie znaleziono usługi');
    }
    if (service.employees.length === 0) {
      throw new NotFoundException('Nie znaleziono pracownika');
    }

    // długość wizyty zawsze z usługi — klient nie przysyła endsAt
    const endsAt = addMinutes(startsAt, service.durationMin);

    return this.prisma.$transaction(async (tx) => {
      // Advisory lock na pracownika: od tego momentu do końca transakcji nikt inny nie
      // zapisuje jego rezerwacji, więc sprawdzenie poniżej jest autorytatywne. Bez tego
      // dwa równoległe requesty odczytałyby „wolne" i oba zapisały ten sam slot.
      // $executeRaw, nie $queryRaw — pg_advisory_xact_lock zwraca `void`, którego Prisma
      // nie umie zdeserializować („Failed to deserialize column of type 'void'").
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(
        ${BOOKING_LOCK_NAMESPACE}::int, hashtext(${dto.employeeId}::text)
      )`;

      // Grafik dnia lokalnego, w którym zaczyna się wizyta — weekday to pojęcie lokalne firmy.
      const localDate = utcToLocalDate(startsAt);
      const workingHours = await tx.workingHours.findMany({
        where: { employeeId: dto.employeeId, weekday: localWeekday(localDate) },
        select: { startTime: true, endTime: true },
      });
      const intervals: WorkInterval[] = workingHours.map((wh) => ({
        startUtc: zonedWallClockToUtc(localDate, wh.startTime),
        endUtc: zonedWallClockToUtc(localDate, wh.endTime),
      }));
      if (!fitsAnyInterval(startsAt, endsAt, intervals)) {
        throw new ConflictException('Wybrany termin jest poza grafikiem pracownika');
      }

      // Urlopy i cudze rezerwacje nachodzące na [startsAt, endsAt) — warunek nachodzenia
      // w WHERE, więc łapie też przedział rozpoczęty wcześniej. overlapsAny na wyniku
      // pilnuje, żeby definicja kolizji była wspólna z generateSlots (styk to nie kolizja).
      const [timeOffs, bookings] = await Promise.all([
        tx.timeOff.findMany({
          where: {
            employeeId: dto.employeeId,
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
          },
          select: { startsAt: true, endsAt: true },
        }),
        tx.booking.findMany({
          where: {
            employeeId: dto.employeeId,
            status: { in: BLOCKING_STATUSES },
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
          },
          select: { startsAt: true, endsAt: true },
        }),
      ]);
      if (overlapsAny(startsAt, endsAt, [...timeOffs, ...bookings])) {
        throw new ConflictException('Wybrany termin jest już zajęty');
      }

      // status zostaje domyślny PENDING ze schematu
      return tx.booking.create({
        data: {
          clientId: userId,
          businessId: service.businessId,
          employeeId: dto.employeeId,
          serviceId: dto.serviceId,
          startsAt,
          endsAt,
          clientNote: dto.clientNote ?? null,
        },
        select: bookingSelect,
      });
    });
  }
}
