import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTimeOffDto } from './dto/create-time-off.dto';

// kształt urlopu zwracany z GET/POST (bez employeeId — jest w route)
const timeOffSelect = {
  id: true,
  startsAt: true,
  endsAt: true,
  reason: true,
} satisfies Prisma.TimeOffSelect;

@Injectable()
export class TimeOffsService {
  constructor(private readonly prisma: PrismaService) {}

  // ponytail: helpery zduplikowane z EmployeesService/WorkingHoursService, żeby ten moduł
  // był niezależny od plików employees.* (edytowanych równolegle w #21). ~8 linii, świadomy duplikat.
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

  // urlopy przyszłe i trwające: endsAt >= teraz
  async list(userId: string, employeeId: string) {
    const businessId = await this.resolveBusinessId(userId);
    await this.assertEmployeeOwned(businessId, employeeId);
    return this.prisma.timeOff.findMany({
      where: { employeeId, endsAt: { gte: new Date() } },
      select: timeOffSelect,
      orderBy: { startsAt: 'asc' },
    });
  }

  async create(userId: string, employeeId: string, dto: CreateTimeOffDto) {
    const businessId = await this.resolveBusinessId(userId);
    await this.assertEmployeeOwned(businessId, employeeId);

    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (startsAt >= endsAt) {
      throw new BadRequestException('startsAt musi być przed endsAt');
    }

    return this.prisma.timeOff.create({
      data: { employeeId, startsAt, endsAt, reason: dto.reason ?? null },
      select: timeOffSelect,
    });
  }

  async remove(userId: string, employeeId: string, timeOffId: string) {
    const businessId = await this.resolveBusinessId(userId);
    await this.assertEmployeeOwned(businessId, employeeId);
    // scope urlopu do pracownika w WHERE — cudzy/nieistniejący urlop → 404
    const { count } = await this.prisma.timeOff.deleteMany({
      where: { id: timeOffId, employeeId },
    });
    if (count === 0) {
      throw new NotFoundException('Nie znaleziono urlopu');
    }
    return { id: timeOffId };
  }
}
