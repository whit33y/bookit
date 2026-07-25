import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
import { CreateBookingDto } from './dto/create-booking.dto';

// Namespace advisory locków tego modułu — pierwszy argument pg_advisory_xact_lock(int, int).
// Stała, żeby klucz z hashtext(employeeId) nie zderzył się z blokadami innego kawałka systemu.
const BOOKING_LOCK_NAMESPACE = 1;

// kształt rezerwacji zwracany z POST /bookings
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
  constructor(private readonly prisma: PrismaService) {}

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
