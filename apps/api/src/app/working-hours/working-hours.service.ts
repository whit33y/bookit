import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SetWorkingHoursDto, WorkingHoursSlotDto } from './dto/set-working-hours.dto';

// kształt grafiku zwracany z GET/PUT: wszystkie 7 dni, sloty posortowane rosnąco
export interface DaySchedule {
  weekday: number;
  slots: { startTime: string; endTime: string }[];
}

@Injectable()
export class WorkingHoursService {
  constructor(private readonly prisma: PrismaService) {}

  // ponytail: helper zduplikowany z EmployeesService, żeby ten moduł był niezależny
  // od plików employees.* (edytowanych równolegle w #18). ~8 linii, świadomy duplikat.
  private async resolveBusinessId(userId: string): Promise<string> {
    const business = await this.prisma.business.findUnique({
      where: { ownerId: userId },
      select: { id: true },
    });
    if (!business) {
      throw new NotFoundException('Nie znaleziono firmy');
    }
    return business.id;
  }

  // scope własności: pracownik musi należeć do firmy właściciela z tokena; inaczej 404
  private async assertEmployeeOwned(businessId: string, employeeId: string): Promise<void> {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, businessId },
      select: { id: true },
    });
    if (!employee) {
      throw new NotFoundException('Nie znaleziono pracownika');
    }
  }

  async getSchedule(userId: string, employeeId: string): Promise<DaySchedule[]> {
    const businessId = await this.resolveBusinessId(userId);
    await this.assertEmployeeOwned(businessId, employeeId);
    const rows = await this.prisma.workingHours.findMany({
      where: { employeeId },
      select: { weekday: true, startTime: true, endTime: true },
      orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
    });
    return this.groupByDay(rows);
  }

  async setSchedule(
    userId: string,
    employeeId: string,
    dto: SetWorkingHoursDto,
  ): Promise<DaySchedule[]> {
    const businessId = await this.resolveBusinessId(userId);
    await this.assertEmployeeOwned(businessId, employeeId);
    this.validateSlots(dto.slots);

    // atomowo: pełne zastąpienie grafiku (usuń wszystko + wstaw nowe)
    await this.prisma.$transaction([
      this.prisma.workingHours.deleteMany({ where: { employeeId } }),
      this.prisma.workingHours.createMany({
        data: dto.slots.map((s) => ({
          employeeId,
          weekday: s.weekday,
          startTime: s.startTime,
          endTime: s.endTime,
        })),
      }),
    ]);

    return this.getSchedule(userId, employeeId);
  }

  // walidacja krzyżowa (poza DTO): start<end oraz przedziały w dniu nie nachodzą na siebie
  private validateSlots(slots: WorkingHoursSlotDto[]): void {
    for (const s of slots) {
      // porównanie stringów "HH:mm" jest poprawne dzięki zero-padding
      if (s.startTime >= s.endTime) {
        throw new BadRequestException(
          `startTime musi być przed endTime (${s.startTime}–${s.endTime})`,
        );
      }
    }
    // grupuj po dniu, sortuj po starcie, sprawdź nachodzenie sąsiednich przedziałów
    for (let weekday = 0; weekday <= 6; weekday++) {
      const day = slots
        .filter((s) => s.weekday === weekday)
        .sort((a, b) => a.startTime.localeCompare(b.startTime));
      for (let i = 1; i < day.length; i++) {
        if (day[i].startTime < day[i - 1].endTime) {
          throw new BadRequestException(
            `Przedziały nachodzą na siebie w dniu ${weekday}`,
          );
        }
      }
    }
  }

  private groupByDay(rows: { weekday: number; startTime: string; endTime: string }[]): DaySchedule[] {
    return Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      slots: rows
        .filter((r) => r.weekday === weekday)
        .map((r) => ({ startTime: r.startTime, endTime: r.endTime })),
    }));
  }
}
