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
import { SearchBusinessesQueryDto } from './dto/search-businesses-query.dto';
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

// wyniki wyszukiwarki (#34) — bez opisu/telefonu, karta na liście wyników nie ich nie pokazuje
const searchResultSelect = {
  id: true,
  slug: true,
  name: true,
  city: true,
  street: true,
  category: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.BusinessSelect;

interface SearchByDistanceRow {
  id: string;
  slug: string;
  name: string;
  city: string;
  street: string;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  distanceKm: number;
}

const DEFAULT_RADIUS_KM = 20; // sensowny promień dla usług lokalnych, gdy klient nie poda własnego
const MIN_RADIUS_KM = 0.1;
const MAX_RADIUS_KM = 300;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_PAGE = 100_000; // DTO dopuszcza dowolnie długi ciąg cyfr — bez górnej granicy Number() przepełnia się do Infinity

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

  // publiczna wyszukiwarka (#34) — bez geo: alfabetycznie przez Prisma; z lat/lng:
  // Haversine liczony natywnie w Postgresie (searchByDistance), żeby filtrować po
  // promieniu i sortować po dystansie w bazie, nie w pamięci procesu
  async search(query: SearchBusinessesQueryDto) {
    const geo = this.parseGeoParams(query);
    const { page, limit } = this.parsePagination(query);

    return geo
      ? this.searchByDistance(query, geo, page, limit)
      : this.searchAlphabetical(query, page, limit);
  }

  private parseGeoParams(
    query: SearchBusinessesQueryDto,
  ): { lat: number; lng: number; radiusKm: number } | null {
    const hasLat = query.lat !== undefined;
    const hasLng = query.lng !== undefined;
    if (hasLat !== hasLng) {
      throw new BadRequestException('lat i lng muszą wystąpić razem');
    }
    if (!hasLat) {
      return null;
    }

    const lat = Number(query.lat);
    const lng = Number(query.lng);
    if (lat < -90 || lat > 90) {
      throw new BadRequestException('lat poza zakresem -90..90');
    }
    if (lng < -180 || lng > 180) {
      throw new BadRequestException('lng poza zakresem -180..180');
    }

    const radiusKm = query.radiusKm !== undefined ? Number(query.radiusKm) : DEFAULT_RADIUS_KM;
    if (radiusKm < MIN_RADIUS_KM || radiusKm > MAX_RADIUS_KM) {
      throw new BadRequestException(`radiusKm poza zakresem ${MIN_RADIUS_KM}..${MAX_RADIUS_KM}`);
    }

    return { lat, lng, radiusKm };
  }

  private parsePagination(query: SearchBusinessesQueryDto): { page: number; limit: number } {
    const page = query.page !== undefined ? Number(query.page) : 1;
    const limit = query.limit !== undefined ? Number(query.limit) : DEFAULT_LIMIT;
    if (page < 1 || page > MAX_PAGE) {
      throw new BadRequestException(`page poza zakresem 1..${MAX_PAGE}`);
    }
    if (limit < 1 || limit > MAX_LIMIT) {
      throw new BadRequestException(`limit poza zakresem 1..${MAX_LIMIT}`);
    }
    return { page, limit };
  }

  // AND wszystkich opcjonalnych filtrów; isBlocked zawsze — zablokowane firmy nie istnieją
  // dla wyszukiwarki (jak w findBySlug)
  private buildWhere(query: SearchBusinessesQueryDto): Prisma.BusinessWhereInput {
    return {
      isBlocked: false,
      ...(query.category ? { category: { slug: query.category } } : {}),
      ...(query.city ? { city: { equals: query.city, mode: 'insensitive' } } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              {
                services: {
                  some: { isActive: true, name: { contains: query.q, mode: 'insensitive' } },
                },
              },
            ],
          }
        : {}),
    } satisfies Prisma.BusinessWhereInput;
  }

  private async searchAlphabetical(query: SearchBusinessesQueryDto, page: number, limit: number) {
    const where = this.buildWhere(query);
    const [items, total] = await Promise.all([
      this.prisma.business.findMany({
        where,
        select: searchResultSelect,
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.business.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  private async searchByDistance(
    query: SearchBusinessesQueryDto,
    geo: { lat: number; lng: number; radiusKm: number },
    page: number,
    limit: number,
  ) {
    const conditions: Prisma.Sql[] = [Prisma.sql`b."isBlocked" = false`];
    if (query.category) {
      conditions.push(Prisma.sql`c.slug = ${query.category}`);
    }
    if (query.city) {
      conditions.push(Prisma.sql`LOWER(b.city) = LOWER(${query.city})`);
    }
    if (query.q) {
      conditions.push(Prisma.sql`(
        b.name ILIKE '%' || ${query.q} || '%'
        OR EXISTS (
          SELECT 1 FROM "Service" s
          WHERE s."businessId" = b.id AND s."isActive" = true
            AND s.name ILIKE '%' || ${query.q} || '%'
        )
      )`);
    }
    const whereSql = Prisma.join(conditions, ' AND ');

    // wzór jak w haversine.ts (patrz komentarz tam) — tu liczony natywnie w SQL, żeby móc
    // filtrować po promieniu i sortować po dystansie bez pobierania wszystkich firm do JS
    const distanceExpr = Prisma.sql`(
      6371 * acos(
        LEAST(1, GREATEST(-1,
          cos(radians(${geo.lat})) * cos(radians(b.lat)) * cos(radians(b.lng) - radians(${geo.lng}))
          + sin(radians(${geo.lat})) * sin(radians(b.lat))
        ))
      )
    )`;

    const offset = (page - 1) * limit;

    const [rows, [{ count }]] = await Promise.all([
      this.prisma.$queryRaw<SearchByDistanceRow[]>`
        SELECT b.id, b.slug, b.name, b.city, b.street,
          c.id as "categoryId", c.name as "categoryName", c.slug as "categorySlug",
          ${distanceExpr} as "distanceKm"
        FROM "Business" b
        JOIN "Category" c ON c.id = b."categoryId"
        WHERE ${whereSql} AND ${distanceExpr} <= ${geo.radiusKm}
        ORDER BY "distanceKm" ASC
        LIMIT ${limit} OFFSET ${offset}
      `,
      this.prisma.$queryRaw<{ count: number }[]>`
        SELECT COUNT(*)::int as count
        FROM "Business" b
        JOIN "Category" c ON c.id = b."categoryId"
        WHERE ${whereSql} AND ${distanceExpr} <= ${geo.radiusKm}
      `,
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        city: r.city,
        street: r.street,
        category: { id: r.categoryId, name: r.categoryName, slug: r.categorySlug },
        distanceKm: Math.round(r.distanceKm * 10) / 10,
      })),
      total: count,
      page,
      limit,
    };
  }

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
