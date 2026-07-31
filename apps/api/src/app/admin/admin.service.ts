import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { parsePagination } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { AdminBusinessesQueryDto } from './dto/admin-businesses-query.dto';
import { AdminUsersQueryDto } from './dto/admin-users-query.dto';

// dane potrzebne do moderacji: właściciel (kontakt), status blokady, daty i skala działalności;
// bez lat/lng i opisu — tabela admina ich nie pokazuje
const adminBusinessSelect = {
  id: true,
  slug: true,
  name: true,
  city: true,
  street: true,
  isBlocked: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, name: true, slug: true } },
  owner: { select: { id: true, email: true, firstName: true, lastName: true } },
  _count: { select: { services: true, employees: true, bookings: true } },
} satisfies Prisma.BusinessSelect;

// jawny select bez passwordHash — jak profileSelect w UsersService; business mówi adminowi,
// czy user jest właścicielem firmy i czy ta firma jest już zablokowana
const adminUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  role: true,
  isBlocked: true,
  createdAt: true,
  business: { select: { id: true, slug: true, name: true, isBlocked: true } },
} satisfies Prisma.UserSelect;

// brak parametru → brak klucza isBlocked w where (obie grupy razem); DTO dopuszcza tylko 'true'/'false'
const blockedFilter = (blocked?: string) =>
  blocked === undefined ? {} : { isBlocked: blocked === 'true' };

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private readonly prisma: PrismaService) {}

  // W przeciwieństwie do publicznej wyszukiwarki (#34) listy admina nie wymuszają isBlocked:false —
  // moderacja musi widzieć również to, co zablokowane.
  async listBusinesses(query: AdminBusinessesQueryDto) {
    const { page, limit, skip } = parsePagination(query);
    const where: Prisma.BusinessWhereInput = {
      ...blockedFilter(query.blocked),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { city: { contains: query.q, mode: 'insensitive' } },
              { owner: { email: { contains: query.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.business.findMany({
        where,
        select: adminBusinessSelect,
        // najnowsze zgłoszenia najpierw — one wymagają uwagi; id jako tiebreaker, bo createdAt
        // to czas startu transakcji (seed wstawia paczkę rekordów z identycznym timestampem),
        // a bez deterministycznej kolejności ten sam rekord potrafi wyjść na dwóch stronach
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.business.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async listUsers(query: AdminUsersQueryDto) {
    const { page, limit, skip } = parsePagination(query);
    const where: Prisma.UserWhereInput = {
      ...blockedFilter(query.blocked),
      ...(query.q
        ? {
            OR: [
              { email: { contains: query.q, mode: 'insensitive' } },
              { firstName: { contains: query.q, mode: 'insensitive' } },
              { lastName: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: adminUserSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], // tiebreaker jak w listBusinesses
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  /**
   * Blokada firmy działa na ścieżkach publicznych: firma znika z wyszukiwarki i profilu
   * (#11/#34 filtrują `isBlocked`), a `POST /bookings` odpada 404-ką
   * (`business: { isBlocked: false }` w BookingsService.create).
   *
   * Zakres jest celowo wąski — flaga zatrzymuje *nowe* rezerwacje, a nie całą aktywność firmy.
   * Nietknięte zostają w szczególności:
   * - rezerwacje już złożone: klient widzi je dalej w „moich wizytach" (AC #41),
   * - decyzje firmy o tych rezerwacjach (`BookingsService.transition` nie patrzy na `isBlocked`),
   *   więc właściciel zablokowanej firmy nadal potwierdzi lub odrzuci zaległy PENDING,
   * - przypomnienia (#38), które filtrują wyłącznie po statusie rezerwacji.
   *
   * Domknięcie tych ścieżek to zmiana kontraktu panelu firmy, poza AC #41 — jeśli moderacja
   * ma odcinać także je, trzeba to zrobić osobnym issue razem z decyzją, co się dzieje
   * z wiszącymi PENDING-ami (auto-odrzucenie? zamrożenie?).
   */
  block(id: string) {
    return this.setBlocked(id, true);
  }

  unblock(id: string) {
    return this.setBlocked(id, false);
  }

  /**
   * Idempotencja wynika z zapisu wartości docelowej zamiast przełączania: n-te `block` zostawia
   * ten sam stan i zwraca tę samą odpowiedź. `updateMany` z warunkiem na bieżący stan oszczędziłby
   * bump `updatedAt`, ale przy `count: 0` nie dałoby się odróżnić „już zablokowana" od „nie ma
   * takiej firmy" bez drugiego zapytania.
   */
  private async setBlocked(id: string, isBlocked: boolean) {
    try {
      const business = await this.prisma.business.update({
        where: { id },
        data: { isBlocked },
        // ten sam kształt co listBusinesses → panel admina (#42) podmienia wiersz w tabeli
        // bez ponownego pobierania całej listy
        select: adminBusinessSelect,
      });

      // ślad audytowy akcji moderacyjnej; slug zamiast danych właściciela — nic wrażliwego w logach
      this.logger.log(
        `${isBlocked ? 'Zablokowano' : 'Odblokowano'} firmę ${business.slug} (${id})`,
      );
      return business;
    } catch (e) {
      // nieistniejące id → 404 zamiast 500 z P2025 (jak w BusinessesService.updateMine)
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
