import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

// widok właściciela — dane pracownika + powiązane konto (email/imię/nazwisko),
// żeby panel #22 pokazał kto jest podpięty
const employeeSelect = {
  id: true,
  name: true,
  isActive: true,
  user: { select: { email: true, firstName: true, lastName: true } },
} satisfies Prisma.EmployeeSelect;

@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService) {}

  // ownerId @unique → własna firma z tokena; brak firmy (ważny token OWNER) → 404
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

  // e-mail istniejącego usera do powiązania; nie nadpisujemy roli właściciela/admina,
  // bo straciliby dostęp do swojego panelu. userId @unique gwarantuje 1 firmę na usera.
  private async resolveLinkedUserId(email: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true },
    });
    if (!user) {
      throw new BadRequestException('Nie znaleziono użytkownika o tym adresie e-mail');
    }
    if (user.role === UserRole.OWNER || user.role === UserRole.ADMIN) {
      throw new BadRequestException('Nie można powiązać właściciela lub administratora');
    }
    return user.id;
  }

  async findAll(userId: string) {
    const businessId = await this.resolveBusinessId(userId);
    // widok właściciela: wszyscy pracownicy, także nieaktywni
    return this.prisma.employee.findMany({
      where: { businessId },
      select: employeeSelect,
      orderBy: { name: 'asc' },
    });
  }

  async create(userId: string, dto: CreateEmployeeDto) {
    const businessId = await this.resolveBusinessId(userId);
    const linkedUserId = dto.email ? await this.resolveLinkedUserId(dto.email) : null;
    try {
      // atomowo: utworzenie pracownika + ustawienie roli EMPLOYEE powiązanemu userowi
      return await this.prisma.$transaction(async (tx) => {
        const employee = await tx.employee.create({
          data: { businessId, name: dto.name, userId: linkedUserId },
          select: employeeSelect,
        });
        if (linkedUserId) {
          await tx.user.update({
            where: { id: linkedUserId },
            data: { role: UserRole.EMPLOYEE },
          });
        }
        return employee;
      });
    } catch (e) {
      throw this.mapLinkConflict(e);
    }
  }

  async update(userId: string, id: string, dto: UpdateEmployeeDto) {
    const businessId = await this.resolveBusinessId(userId);
    // scope własności w WHERE — cudzy/nieistniejący pracownik → 404.
    // userId potrzebny, by cofnąć rolę poprzednio powiązanemu userowi przy przepięciu.
    const employee = await this.prisma.employee.findFirst({
      where: { id, businessId },
      select: { id: true, userId: true },
    });
    if (!employee) {
      throw new NotFoundException('Nie znaleziono pracownika');
    }
    const linkedUserId = dto.email ? await this.resolveLinkedUserId(dto.email) : undefined;
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (linkedUserId) {
          await tx.user.update({
            where: { id: linkedUserId },
            data: { role: UserRole.EMPLOYEE },
          });
          // przepięcie na inne konto → poprzednie traci status pracownika
          if (employee.userId && employee.userId !== linkedUserId) {
            await tx.user.update({
              where: { id: employee.userId },
              data: { role: UserRole.CLIENT },
            });
          }
        }
        return tx.employee.update({
          where: { id },
          data: {
            name: dto.name,
            isActive: dto.isActive,
            ...(linkedUserId ? { userId: linkedUserId } : {}),
          },
          select: employeeSelect,
        });
      });
    } catch (e) {
      throw this.mapLinkConflict(e);
    }
  }

  async remove(userId: string, id: string) {
    const businessId = await this.resolveBusinessId(userId);
    // jedno zapytanie: własność (businessId) + czy są rezerwacje + powiązane konto
    const employee = await this.prisma.employee.findFirst({
      where: { id, businessId },
      select: { id: true, userId: true, _count: { select: { bookings: true } } },
    });
    if (!employee) {
      throw new NotFoundException('Nie znaleziono pracownika');
    }
    // pracownik z rezerwacjami: dezaktywacja zamiast usunięcia (AC #17) —
    // zachowuje historię i nie łamie FK Booking→Employee (brak cascade).
    // Dezaktywacja zostawia powiązanie i rolę (rekord istnieje, reaktywacja #22 spójna).
    if (employee._count.bookings > 0) {
      return this.deactivate(id);
    }
    try {
      // usunięcie + cofnięcie roli powiązanemu userowi atomowo
      await this.prisma.$transaction(async (tx) => {
        await tx.employee.delete({ where: { id } });
        if (employee.userId) {
          await tx.user.update({
            where: { id: employee.userId },
            data: { role: UserRole.CLIENT },
          });
        }
      });
    } catch (e) {
      // wyścig: rezerwacja powstała po zliczeniu → FK (P2003); zamiast 500 dezaktywujemy
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
        return this.deactivate(id);
      }
      throw e;
    }
    return { id, deactivated: false };
  }

  // spójny kształt odpowiedzi z remove(): deactivated rozróżnia dezaktywację od usunięcia
  private async deactivate(id: string) {
    const employee = await this.prisma.employee.update({
      where: { id },
      data: { isActive: false },
      select: employeeSelect,
    });
    return { ...employee, deactivated: true };
  }

  // kolizja userId @unique → user jest już pracownikiem (innej) firmy
  private mapLinkConflict(e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new BadRequestException('Użytkownik jest już pracownikiem');
    }
    return e;
  }
}
