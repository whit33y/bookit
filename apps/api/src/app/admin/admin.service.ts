import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { BusinessStatus, Prisma, UserRole } from '@prisma/client';
import { parsePagination } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessApplicationEventsService } from './business-application-events.service';
import { AdminApplicationsQueryDto } from './dto/admin-applications-query.dto';
import { AdminBusinessesQueryDto } from './dto/admin-businesses-query.dto';
import { AdminUsersQueryDto } from './dto/admin-users-query.dto';
import { RejectApplicationDto } from './dto/reject-application.dto';

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

// kolejka zgłoszeń (#143): to samo co w rejestrze plus stan sprawy — kolejka pokazuje
// wyłącznie PENDING, ale decyzja oddaje ten sam kształt z już zmienionym statusem,
// więc panel admina podmienia wiersz bez ponownego pobierania listy
const adminApplicationSelect = {
  ...adminBusinessSelect,
  status: true,
  rejectionReason: true,
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

// Fraza szuka po nazwie firmy, mieście i emailu właściciela — jedno miejsce dla rejestru
// i kolejki zgłoszeń, żeby obie listy nie rozjechały się przy dodaniu kolejnej kolumny.
const phraseFilter = (q?: string): Prisma.BusinessWhereInput =>
  q === undefined
    ? {}
    : {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { city: { contains: q, mode: 'insensitive' } },
          { owner: { email: { contains: q, mode: 'insensitive' } } },
        ],
      };

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: BusinessApplicationEventsService,
  ) {}

  /**
   * Rejestr firm. W przeciwieństwie do publicznej wyszukiwarki (#34) nie wymusza
   * `isBlocked: false` — moderacja musi widzieć również to, co zablokowane.
   *
   * Domyślnie wyłącznie APPROVED (#143): rejestr pokazuje firmy, które administrator już
   * wpuścił, a zgłoszenia czekające na decyzję mają własną ścieżkę — kolejkę. Bez tego
   * defaultu kolejka i rejestr mieszałyby się na jednej liście, a praca do wykonania
   * ginęłaby wśród setek firm. `?status=` pozwala zajrzeć do pozostałych stanów
   * (np. archiwum odrzuceń), ale wymaga świadomego kliknięcia.
   */
  async listBusinesses(query: AdminBusinessesQueryDto) {
    const { page, limit, skip } = parsePagination(query);
    const where: Prisma.BusinessWhereInput = {
      status: query.status ?? BusinessStatus.APPROVED,
      ...blockedFilter(query.blocked),
      ...phraseFilter(query.q),
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
   * Kolejka zgłoszeń (#143): wyłącznie PENDING, bo to praca do wykonania, która ma się
   * wyzerować (CONTEXT.md) — rozpatrzone zgłoszenia idą do rejestru firm i nie wracają tu
   * jako filtr.
   *
   * Najstarsze pierwsze, odwrotnie niż w listach rejestru: w kolejce liczy się to, co czeka
   * najdłużej, a nie to, co przyszło ostatnie. `id` jako tiebreaker z tego samego powodu
   * co wyżej — bez niego jedno zgłoszenie wychodzi na dwóch sąsiednich stronach.
   */
  async listApplications(query: AdminApplicationsQueryDto) {
    const { page, limit, skip } = parsePagination(query);
    const where: Prisma.BusinessWhereInput = {
      status: BusinessStatus.PENDING,
      ...phraseFilter(query.q),
    };

    const [items, total] = await Promise.all([
      this.prisma.business.findMany({
        where,
        select: adminApplicationSelect,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.business.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  /**
   * Akceptacja zgłoszenia: jedna transakcja `status → APPROVED` **i** awans zgłaszającego
   * na OWNER. Rozdzielenie tych zapisów zostawiałoby okno, w którym firma jest już widoczna
   * publicznie, a jej właściciel nie ma panelu, żeby cokolwiek z nią zrobić.
   *
   * Powiadomienie leci poza transakcją (patrz BusinessApplicationEventsService).
   */
  async approve(id: string) {
    const application = await this.decide(
      id,
      { status: BusinessStatus.APPROVED },
      // updateMany z warunkiem na rolę, nie update: awans ma podnosić CLIENT-a, a nie
      // nadpisywać cudzą rolę w dół. Dziś zgłoszenie może złożyć wyłącznie CLIENT albo OWNER
      // (`POST /businesses`), ale bezwarunkowy zapis czekałby na pierwsze konto ADMIN-a
      // z własnym zgłoszeniem, żeby po cichu odebrać mu panel administratora.
      (tx, ownerId) =>
        tx.user.updateMany({
          where: { id: ownerId, role: UserRole.CLIENT },
          data: { role: UserRole.OWNER },
        }),
    );

    // ślad audytowy jak przy block/unblock — slug i id, bez danych właściciela
    this.logger.log(`Zaakceptowano zgłoszenie firmy ${application.slug} (${id})`);
    this.events.approved(id);
    return application;
  }

  /**
   * Odrzucenie: `status → REJECTED` plus powód, którym zgłaszający ma się kierować przy
   * poprawianiu. Rola użytkownika zostaje bez zmian — zgłaszający był i pozostaje CLIENT-em.
   */
  async reject(id: string, dto: RejectApplicationDto) {
    const application = await this.decide(id, {
      status: BusinessStatus.REJECTED,
      // przycięcie tutaj, nie w DTO: walidacja pilnuje kształtu, a zapis ma trafić do maila
      // i na formularz zgłaszającego bez wiodących spacji
      rejectionReason: dto.reason.trim(),
    });

    this.logger.log(`Odrzucono zgłoszenie firmy ${application.slug} (${id})`);
    this.events.rejected(id);
    return application;
  }

  /**
   * Wspólna część obu decyzji. Warunek `status: PENDING` jest częścią zapisu, a nie
   * sprawdzeniem przed nim: przy dwóch adminach klikających naraz drugi zapis musi przegrać,
   * a nie nadpisać cudzą decyzję. `count: 0` znaczy „nie ma zgłoszenia" **albo** „decyzja
   * już zapadła" — rozstrzyga to dopiero odczyt, stąd 404 i 409 dopiero tam (ten sam wzorzec
   * co w InAppNotificationsService.markRead).
   *
   * Wiersz w odpowiedzi czytamy po zapisie, bo `updateMany` nie zwraca danych — nadal wewnątrz
   * transakcji, więc odpowiedź nie może pokazać stanu sprzed równoległego `block`.
   */
  private async decide(
    id: string,
    data: Prisma.BusinessUpdateManyMutationInput,
    afterUpdate?: (tx: Prisma.TransactionClient, ownerId: string) => Promise<unknown>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.business.updateMany({
        where: { id, status: BusinessStatus.PENDING },
        data,
      });

      if (count === 0) {
        const existing = await tx.business.findUnique({
          where: { id },
          select: { status: true },
        });
        if (!existing) {
          throw new NotFoundException('Nie znaleziono zgłoszenia');
        }
        throw new ConflictException('Zgłoszenie zostało już rozpatrzone');
      }

      const application = await tx.business.findUniqueOrThrow({
        where: { id },
        select: adminApplicationSelect,
      });
      await afterUpdate?.(tx, application.owner.id);
      return application;
    });
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
