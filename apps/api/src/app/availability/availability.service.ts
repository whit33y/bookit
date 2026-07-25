import { Injectable, NotFoundException } from '@nestjs/common';
import { BookingStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  localDayRangeUtc,
  localWeekday,
  parseLocalDate,
  zonedWallClockToUtc,
} from './business-time';
import { AvailabilityQueryDto } from './dto/availability-query.dto';
import { BusyInterval, WorkInterval, generateSlots } from './slots.util';

// PENDING blokuje slot tak samo jak CONFIRMED (SDD §7) — inaczej firma mogłaby
// dostać dwie kolizyjne rezerwacje na ten sam termin
const BLOCKING_STATUSES = [BookingStatus.PENDING, BookingStatus.CONFIRMED];

export interface AvailableSlot {
  employeeId: string;
  startsAt: string; // ISO 8601, UTC
}

@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async getSlots(slug: string, query: AvailabilityQueryDto): Promise<AvailableSlot[]> {
    const date = parseLocalDate(query.date);

    // isBlocked w WHERE, nie po fetchu → zablokowana i nieistniejąca dają identyczne 404
    // (tak jak BusinessesService.findBySlug)
    const business = await this.prisma.business.findFirst({
      where: { slug, isBlocked: false },
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
    if (employeeIds.length === 0) {
      // podany pracownik nie wykonuje tej usługi / jest nieaktywny → 404;
      // bez employeeId to po prostu usługa bez przypisanych pracowników → brak slotów
      if (query.employeeId) {
        throw new NotFoundException('Nie znaleziono pracownika');
      }
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
      const intervals: WorkInterval[] = workingHours
        .filter((wh) => wh.employeeId === employeeId)
        .map((wh) => ({
          startUtc: zonedWallClockToUtc(date, wh.startTime),
          endUtc: zonedWallClockToUtc(date, wh.endTime),
        }));

      const busy: BusyInterval[] = [...timeOffs, ...bookings].filter(
        (b) => b.employeeId === employeeId,
      );

      return generateSlots({
        intervals,
        busy,
        durationMin: service.durationMin,
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
}
