import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { serviceClientFields } from '../services/services.service';
import { CreateBusinessDto } from './dto/create-business.dto';
import { UpdateBusinessDto } from './dto/update-business.dto';

// bez ownerId i isBlocked — profil firmy jest publiczny
const businessSelect = {
  id: true,
  slug: true,
  name: true,
  description: true,
  phone: true,
  street: true,
  city: true,
  postalCode: true,
  lat: true,
  lng: true,
  cancellationHours: true,
  categoryId: true,
  createdAt: true,
} satisfies Prisma.BusinessSelect;

// publiczny profil: zagnieżdżona kategoria + aktywne usługi/pracownicy; bez ownerId/isBlocked/owner
const publicProfileSelect = {
  id: true,
  slug: true,
  name: true,
  description: true,
  phone: true,
  street: true,
  city: true,
  postalCode: true,
  lat: true,
  lng: true,
  cancellationHours: true,
  category: { select: { id: true, name: true, slug: true } },
  services: {
    where: { isActive: true },
    select: {
      ...serviceClientFields,
      // przypisania pracownik↔usługa (m:n) — którzy aktywni pracownicy wykonują usługę
      employees: { where: { isActive: true }, select: { id: true, name: true } },
    },
    orderBy: { name: 'asc' },
  },
  employees: {
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  },
} satisfies Prisma.BusinessSelect;

const SLUG_ATTEMPTS = 3;

// NFD rozkłada ą/ć/ę/…, ale nie ł — stąd osobne podmiany
export const slugify = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'firma';

const isUniqueViolationOn = (e: unknown, field: string) =>
  e instanceof Prisma.PrismaClientKnownRequestError &&
  e.code === 'P2002' &&
  String(e.meta?.target ?? '').includes(field);

@Injectable()
export class BusinessesService {
  constructor(private readonly prisma: PrismaService) {}

  async findBySlug(slug: string) {
    // isBlocked w WHERE, nie po fetchu → zablokowana i nieistniejąca dają identyczne 404 (nie zdradza istnienia)
    const business = await this.prisma.business.findFirst({
      where: { slug, isBlocked: false },
      select: publicProfileSelect,
    });
    if (!business) {
      throw new NotFoundException('Nie znaleziono firmy');
    }
    return business;
  }

  async findMine(userId: string) {
    // ownerId @unique → własna firma z tokena; brak firmy (ważny token OWNER) → 404
    const business = await this.prisma.business.findUnique({
      where: { ownerId: userId },
      select: businessSelect,
    });
    if (!business) {
      throw new NotFoundException('Nie znaleziono firmy');
    }
    return business;
  }

  async create(userId: string, dto: CreateBusinessDto) {
    const base = slugify(dto.name);

    for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
      // ponytail: losowy sufiks przy kolizji zamiast zliczania -2/-3 — bez dodatkowego zapytania
      const slug =
        attempt === 0 ? base : `${base}-${randomBytes(2).toString('hex')}`;
      try {
        // firma i awans na OWNER muszą powstać razem
        return await this.prisma.$transaction(async (tx) => {
          const business = await tx.business.create({
            data: { ...dto, ownerId: userId, slug },
            select: businessSelect,
          });
          await tx.user.update({
            where: { id: userId },
            data: { role: UserRole.OWNER },
          });
          return business;
        });
      } catch (e) {
        if (isUniqueViolationOn(e, 'ownerId')) {
          throw new ConflictException('Masz już założoną firmę');
        }
        // nieistniejąca kategoria → FK; tańsze niż osobny select przed insertem
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2003'
        ) {
          throw new BadRequestException('Nie znaleziono kategorii');
        }
        if (!isUniqueViolationOn(e, 'slug')) {
          throw e;
        }
      }
    }

    throw new ConflictException('Nie udało się wygenerować unikalnego adresu');
  }

  async updateMine(userId: string, dto: UpdateBusinessDto) {
    try {
      // ownerId @unique → edytuje wyłącznie własną firmę (klucz z tokena, nie z body)
      return await this.prisma.business.update({
        where: { ownerId: userId },
        data: dto,
        select: businessSelect,
      });
    } catch (e) {
      // OWNER bez firmy (ważny token) → 404 zamiast 500 z P2025
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2025'
      ) {
        throw new NotFoundException('Nie znaleziono firmy');
      }
      throw e;
    }
  }
}
