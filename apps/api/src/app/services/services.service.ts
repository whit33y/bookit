import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

// pola usługi widoczne dla klienta — reużywane w publicznym profilu firmy (#11),
// żeby kształt usługi nie rozjechał się między modułami
export const serviceClientFields = {
  id: true,
  name: true,
  description: true,
  durationMin: true,
  priceCents: true,
} satisfies Prisma.ServiceSelect;

// widok właściciela — dodatkowo isActive (publiczny profil #11 filtruje isActive osobno)
const serviceSelect = {
  ...serviceClientFields,
  isActive: true,
} satisfies Prisma.ServiceSelect;

@Injectable()
export class ServicesService {
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

  async findAll(userId: string) {
    const businessId = await this.resolveBusinessId(userId);
    // widok właściciela: wszystkie usługi, także nieaktywne; z przypisanymi
    // pracownikami, żeby panel (#21) mógł wypełnić multi-select bez osobnego GET
    return this.prisma.service.findMany({
      where: { businessId },
      select: {
        ...serviceSelect,
        employees: { select: { id: true, name: true }, orderBy: { name: 'asc' } },
      },
      orderBy: { name: 'asc' },
    });
  }

  // przypisanie pracowników do usługi (m:n) — replace całej listy (idempotentne)
  async setEmployees(userId: string, serviceId: string, employeeIds: string[]) {
    const businessId = await this.resolveBusinessId(userId);
    // usługa musi należeć do firmy właściciela; cudza/nieistniejąca → 404
    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, businessId },
      select: { id: true },
    });
    if (!service) {
      throw new NotFoundException('Nie znaleziono usługi');
    }
    // każdy pracownik musi być z tej samej firmy; count < długość →
    // ktoś spoza firmy lub nieistniejący → 400 (AC #18).
    // DTO (@ArrayUnique) gwarantuje brak duplikatów, więc length == liczba unikatów.
    if (employeeIds.length > 0) {
      const count = await this.prisma.employee.count({
        where: { id: { in: employeeIds }, businessId },
      });
      if (count !== employeeIds.length) {
        throw new BadRequestException('Pracownik spoza Twojej firmy');
      }
    }
    try {
      return await this.prisma.service.update({
        where: { id: serviceId },
        data: { employees: { set: employeeIds.map((id) => ({ id })) } },
        select: {
          ...serviceSelect,
          employees: { select: { id: true, name: true }, orderBy: { name: 'asc' } },
        },
      });
    } catch (e) {
      // wyścig: pracownik usunięty po zliczeniu → set rzuca P2025; zamiast 500 → 400
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new BadRequestException('Pracownik spoza Twojej firmy');
      }
      throw e;
    }
  }

  async create(userId: string, dto: CreateServiceDto) {
    const businessId = await this.resolveBusinessId(userId);
    return this.prisma.service.create({
      data: { ...dto, businessId },
      select: serviceSelect,
    });
  }

  async update(userId: string, id: string, dto: UpdateServiceDto) {
    const businessId = await this.resolveBusinessId(userId);
    // updateMany zamiast update — pozwala scope'ować po businessId (własność) w WHERE;
    // cudza/nieistniejąca usługa → count 0 → 404
    const { count } = await this.prisma.service.updateMany({
      where: { id, businessId },
      data: dto,
    });
    if (count === 0) {
      throw new NotFoundException('Nie znaleziono usługi');
    }
    return this.prisma.service.findUnique({ where: { id }, select: serviceSelect });
  }

  async remove(userId: string, id: string) {
    const businessId = await this.resolveBusinessId(userId);
    // jedno zapytanie: własność (businessId) + czy są rezerwacje
    const service = await this.prisma.service.findFirst({
      where: { id, businessId },
      select: { id: true, _count: { select: { bookings: true } } },
    });
    if (!service) {
      throw new NotFoundException('Nie znaleziono usługi');
    }
    // usługa z rezerwacjami: dezaktywacja zamiast usunięcia (AC #16) —
    // zachowuje historię i nie łamie FK Booking→Service (brak cascade)
    if (service._count.bookings > 0) {
      return this.deactivate(id);
    }
    try {
      await this.prisma.service.delete({ where: { id } });
    } catch (e) {
      // wyścig: rezerwacja powstała po zliczeniu → FK (P2003); zamiast 500 dezaktywujemy
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2003'
      ) {
        return this.deactivate(id);
      }
      throw e;
    }
    return { id, deactivated: false };
  }

  // spójny kształt odpowiedzi z remove(): deactivated rozróżnia dezaktywację od usunięcia
  private async deactivate(id: string) {
    const service = await this.prisma.service.update({
      where: { id },
      data: { isActive: false },
      select: serviceSelect,
    });
    return { ...service, deactivated: true };
  }
}
