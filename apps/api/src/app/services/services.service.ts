import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

// widok właściciela — z isActive (publiczny profil #11 filtruje isActive osobno)
const serviceSelect = {
  id: true,
  name: true,
  description: true,
  durationMin: true,
  priceCents: true,
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
    // widok właściciela: wszystkie usługi, także nieaktywne
    return this.prisma.service.findMany({
      where: { businessId },
      select: serviceSelect,
      orderBy: { name: 'asc' },
    });
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
      return this.prisma.service.update({
        where: { id },
        data: { isActive: false },
        select: serviceSelect,
      });
    }
    await this.prisma.service.delete({ where: { id } });
    return { id };
  }
}
