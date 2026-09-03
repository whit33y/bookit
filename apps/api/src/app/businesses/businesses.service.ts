import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BusinessStatus, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { Pagination, parsePagination } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { EMPTY_REVIEW_STATS } from '../reviews/review-stats';
import { ReviewsService } from '../reviews/reviews.service';
import { serviceClientFields } from '../services/services.service';
import { CreateBusinessDto } from './dto/create-business.dto';
import { publicBusinessSql, publicBusinessWhere } from './public-business';
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

// zgłoszenie firmy (#141) widziane przez zgłaszającego: to samo co panel plus stan sprawy.
// `status` i `rejectionReason` wychodzą wyłącznie tędy — publiczne ścieżki firm w stanie
// innym niż APPROVED w ogóle nie zwracają.
const applicationSelect = {
  ...businessSelect,
  status: true,
  rejectionReason: true,
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

// wyniki wyszukiwarki (#34) — bez opisu/telefonu, karta na liście wyników nie ich nie pokazuje;
// lat/lng potrzebne dla pinezek na mapie wyników (#35)
const searchResultSelect = {
  id: true,
  slug: true,
  name: true,
  city: true,
  street: true,
  lat: true,
  lng: true,
  category: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.BusinessSelect;

interface SearchByDistanceRow {
  id: string;
  slug: string;
  name: string;
  city: string;
  street: string;
  lat: number;
  lng: number;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  distanceKm: number;
}

const DEFAULT_RADIUS_KM = 20; // sensowny promień dla usług lokalnych, gdy klient nie poda własnego
const MIN_RADIUS_KM = 0.1;
const MAX_RADIUS_KM = 300;

const SLUG_ATTEMPTS = 3;

// Odpowiednik defaultu ze schematu Prismy. Powtórzony tutaj, bo ponowne zgłoszenie nadpisuje
// istniejący wiersz — default z bazy zadziałałby tylko przy insercie, a formularz bez tego pola
// zostawiłby politykę odwołań z poprzedniej, odrzuconej wersji zgłoszenia.
const DEFAULT_CANCELLATION_HOURS = 24;

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly reviews: ReviewsService,
  ) {}

  /**
   * Doklejenie agregatu ocen (#47): jedno zapytanie na całą stronę wyników, niezależnie od tego,
   * czy powstała przez Prismę (searchAlphabetical), przez surowy SQL Haversine (searchByDistance),
   * czy to pojedynczy profil. Dzięki temu średnia liczy się w jednym miejscu i zapytania
   * geograficznego nie trzeba rozbudowywać o podselekt.
   */
  private async withReviewStats<T extends { id: string }>(items: T[]) {
    const stats = await this.reviews.statsFor(items.map((item) => item.id));
    return items.map((item) => ({
      ...item,
      // firma bez recenzji nie wraca z groupBy — dostaje avgRating: null, nie 0
      ...(stats.get(item.id) ?? EMPTY_REVIEW_STATS),
    }));
  }

  // publiczna wyszukiwarka (#34) — bez geo: alfabetycznie przez Prisma; z lat/lng:
  // Haversine liczony natywnie w Postgresie (searchByDistance), żeby filtrować po
  // promieniu i sortować po dystansie w bazie, nie w pamięci procesu
  async search(query: SearchBusinessesQueryDto) {
    const geo = this.parseGeoParams(query);
    const pagination = parsePagination(query);

    return geo
      ? this.searchByDistance(query, geo, pagination)
      : this.searchAlphabetical(query, pagination);
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

  // AND wszystkich opcjonalnych filtrów; warunek „firma działa" zawsze — niewpuszczone
  // i zablokowane firmy nie istnieją dla wyszukiwarki (jak w findBySlug)
  private buildWhere(query: SearchBusinessesQueryDto): Prisma.BusinessWhereInput {
    return {
      ...publicBusinessWhere,
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

  private async searchAlphabetical(
    query: SearchBusinessesQueryDto,
    { page, limit, skip }: Pagination,
  ) {
    const where = this.buildWhere(query);
    const [items, total] = await Promise.all([
      this.prisma.business.findMany({
        where,
        select: searchResultSelect,
        orderBy: { name: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.business.count({ where }),
    ]);
    return { items: await this.withReviewStats(items), total, page, limit };
  }

  private async searchByDistance(
    query: SearchBusinessesQueryDto,
    geo: { lat: number; lng: number; radiusKm: number },
    { page, limit, skip }: Pagination,
  ) {
    const conditions: Prisma.Sql[] = [publicBusinessSql];
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

    const [rows, [{ count }]] = await Promise.all([
      this.prisma.$queryRaw<SearchByDistanceRow[]>`
        SELECT b.id, b.slug, b.name, b.city, b.street, b.lat, b.lng,
          c.id as "categoryId", c.name as "categoryName", c.slug as "categorySlug",
          ${distanceExpr} as "distanceKm"
        FROM "Business" b
        JOIN "Category" c ON c.id = b."categoryId"
        WHERE ${whereSql} AND ${distanceExpr} <= ${geo.radiusKm}
        ORDER BY "distanceKm" ASC
        LIMIT ${limit} OFFSET ${skip}
      `,
      this.prisma.$queryRaw<{ count: number }[]>`
        SELECT COUNT(*)::int as count
        FROM "Business" b
        JOIN "Category" c ON c.id = b."categoryId"
        WHERE ${whereSql} AND ${distanceExpr} <= ${geo.radiusKm}
      `,
    ]);

    const items = rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      city: r.city,
      street: r.street,
      lat: r.lat,
      lng: r.lng,
      category: { id: r.categoryId, name: r.categoryName, slug: r.categorySlug },
      distanceKm: Math.round(r.distanceKm * 10) / 10,
    }));

    return {
      items: await this.withReviewStats(items),
      total: count,
      page,
      limit,
    };
  }

  async findBySlug(slug: string) {
    // warunek w WHERE, nie po fetchu → firma niedziałająca i nieistniejąca dają identyczne 404
    // (nie zdradza istnienia — ani zgłoszenia, ani blokady)
    const business = await this.prisma.business.findFirst({
      where: { slug, ...publicBusinessWhere },
      select: publicProfileSelect,
    });
    if (!business) {
      throw new NotFoundException('Nie znaleziono firmy');
    }

    // profil niesie ten sam agregat co karta w wyszukiwarce (#47), więc idzie tym samym helperem
    const [profile] = await this.withReviewStats([business]);
    return profile;
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

  /**
   * Stan własnego zgłoszenia (#141) — dla zgłaszającego, który jest jeszcze CLIENT-em i nie ma
   * panelu firmy. Osobne od findMine: tam chodzi o działającą firmę i jej dane do edycji,
   * tutaj o sprawę w toku, razem z powodem odrzucenia.
   */
  async findApplication(userId: string) {
    const application = await this.prisma.business.findUnique({
      where: { ownerId: userId },
      select: applicationSelect,
    });
    if (!application) {
      throw new NotFoundException('Nie znaleziono zgłoszenia');
    }
    return application;
  }

  /**
   * Zgłoszenie firmy: wiersz powstaje w PENDING i nic nie robi, dopóki administrator go nie
   * zaakceptuje (#143) — zgłaszający zostaje CLIENT-em, rolę OWNER daje dopiero akceptacja.
   *
   * Slug nadajemy już tutaj, nie przy akceptacji: kolizja ma się rozstrzygnąć, gdy użytkownik
   * patrzy na formularz, a nie wywalić decyzję administratora tydzień później.
   */
  async create(userId: string, dto: CreateBusinessDto) {
    // Ponowne zgłoszenie po odrzuceniu nadpisuje ten sam wiersz — `ownerId` jest @unique,
    // więc „jedna firma na konto" pilnuje się samo, a odrzucenie nie zamyka drogi.
    // Wyścig dwóch równoległych zgłoszeń łapie niżej P2002 na ownerId.
    const existing = await this.prisma.business.findUnique({
      where: { ownerId: userId },
      select: { id: true, status: true },
    });
    if (existing && existing.status !== BusinessStatus.REJECTED) {
      throw new ConflictException(
        existing.status === BusinessStatus.PENDING
          ? 'Twoje zgłoszenie czeka na rozpatrzenie'
          : 'Masz już założoną firmę',
      );
    }

    const base = slugify(dto.name);

    for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
      // ponytail: losowy sufiks przy kolizji zamiast zliczania -2/-3 — bez dodatkowego zapytania
      const slug =
        attempt === 0 ? base : `${base}-${randomBytes(2).toString('hex')}`;
      // Ponowne zgłoszenie wraca do PENDING i traci poprzedni powód odrzucenia. Pola opcjonalne
      // zapisujemy jawnie: to nowe zgłoszenie w całości, a nie łatka na poprzednie — bez tego
      // Prisma pominęłaby brakujące klucze i w wierszu zostałyby dane z odrzuconej wersji.
      const data = {
        ...dto,
        description: dto.description ?? null,
        phone: dto.phone ?? null,
        postalCode: dto.postalCode ?? null,
        cancellationHours: dto.cancellationHours ?? DEFAULT_CANCELLATION_HOURS,
        slug,
        status: BusinessStatus.PENDING,
        rejectionReason: null,
      };
      try {
        return existing
          ? await this.prisma.business.update({
              where: { id: existing.id },
              data,
              select: applicationSelect,
            })
          : await this.prisma.business.create({
              data: { ...data, ownerId: userId },
              select: applicationSelect,
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
