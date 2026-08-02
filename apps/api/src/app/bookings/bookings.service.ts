import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { BookingStatus, PaymentStatus, Prisma, UserRole } from '@prisma/client';
import {
  addMinutes,
  isOnSlotGrid,
  localWeekday,
  localDayRangeUtc,
  parseLocalDate,
  utcToLocalDate,
  zonedWallClockToUtc,
} from '../availability/business-time';
import {
  BLOCKING_STATUSES,
  WorkInterval,
  fitsAnyInterval,
  overlapsAny,
} from '../availability/slots.util';
import { AuthUser } from '../common/types/auth-user';
import { depositAmountCents } from '../payments/deposit';
import { PAYMENT_CURRENCY, paymentDeadline } from '../payments/payment-window';
import { PaymentsService, UnpaidPayment } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { serviceClientFields } from '../services/services.service';
import { BookingEventsService } from './booking-events.service';
import { STATUS_LABELS, canTransition } from './booking-status';
import {
  canClientCancel,
  cancellationWindowMessage,
} from './cancellation-policy';
import { BusinessBookingsQueryDto } from './dto/business-bookings-query.dto';
import { CreateBookingDto } from './dto/create-booking.dto';

// Namespace advisory locków tego modułu — pierwszy argument pg_advisory_xact_lock(int, int).
// Stała, żeby klucz z hashtext(employeeId) nie zderzył się z blokadami innego kawałka systemu.
const BOOKING_LOCK_NAMESPACE = 1;

// kształt rezerwacji zwracany z POST /bookings i z decyzji firmy (confirm/decline)
const bookingSelect = {
  id: true,
  businessId: true,
  employeeId: true,
  serviceId: true,
  startsAt: true,
  endsAt: true,
  status: true,
  clientNote: true,
} satisfies Prisma.BookingSelect;

// To samo plus świeżo utworzona zaliczka — POST /bookings potrzebuje jej id (żeby dopiąć
// PaymentIntent) i createdAt (żeby policzyć termin ważności). Osobny select, bo confirm/decline
// zwracają bookingSelect i nie mają po co wozić danych płatności.
const createdBookingSelect = {
  ...bookingSelect,
  payment: { select: { id: true, createdAt: true } },
} satisfies Prisma.BookingSelect;

// Zaliczka pokazywana na listach rezerwacji. Bez client_secret — ten wychodzi wyłącznie
// z odpowiedzi na POST /bookings, bo jest jednorazowym poświadczeniem do zapłaty i nie ma
// prawa wyciec z listy, którą ogląda też firma.
const paymentListSelect = {
  select: { status: true, amountCents: true },
} as const;

// Karta wizyty na liście klienta (#28) — komplet danych do wyświetlenia bez dopytywania
// o firmę/usługę/pracownika. Firma bez ownerId i isBlocked, tak jak w businessSelect;
// cancellationHours zostaje, bo z niej liczy się canCancel i UI ma czym uzasadnić brak
// przycisku „odwołaj". clientId pomijamy — to zawsze pytający.
const clientBookingSelect = {
  id: true,
  startsAt: true,
  endsAt: true,
  status: true,
  clientNote: true,
  createdAt: true,
  business: {
    select: {
      id: true,
      slug: true,
      name: true,
      phone: true,
      street: true,
      city: true,
      postalCode: true,
      cancellationHours: true,
    },
  },
  service: { select: serviceClientFields },
  employee: { select: { id: true, name: true } },
  // Wystawiona recenzja albo null (#47). Bez tego pola #48 nie odróżni odbytej wizyty bez oceny
  // od już ocenionej, więc akcji „oceń wizytę" nie dałoby się pokazać warunkowo — a dopytywanie
  // o to osobnym requestem per wizyta mnożyłoby zapytania na całą listę.
  review: {
    select: { id: true, rating: true, comment: true, createdAt: true },
  },
  // null = usługa bez zaliczki; PENDING = czeka na opłacenie (#53 pokazuje po tym stan
  // płatności i przycisk „zapłać")
  payment: paymentListSelect,
} satisfies Prisma.BookingSelect;

type ClientBooking = Prisma.BookingGetPayload<{
  select: typeof clientBookingSelect;
}>;

// Kafelek kalendarza firmy (#31) — dane klienta (imię, telefon) i pracownika zamiast firmy,
// bo to widok firmy patrzącej na własne rezerwacje, nie klienta. Bez business/canCancel —
// to nie jest karta klienta.
const businessBookingSelect = {
  id: true,
  startsAt: true,
  endsAt: true,
  status: true,
  clientNote: true,
  client: { select: { firstName: true, lastName: true, phone: true } },
  service: { select: serviceClientFields },
  employee: { select: { id: true, name: true } },
  // firma widzi w kalendarzu, czy zaliczka wpłynęła — nieopłaconej rezerwacji i tak
  // nie potwierdzi (409 w transition)
  payment: paymentListSelect,
} satisfies Prisma.BookingSelect;

/**
 * AC #28: „flaga per rezerwacja, czy odwołanie jest jeszcze możliwe wg polityki (front nie
 * liczy tego sam)". Ta sama funkcja, której używa transition(), więc flaga mówi dokładnie
 * to, co zrobi POST /bookings/:id/cancel — łącznie z przypadkami, które wyglądają na
 * wyjątki (zaległy PENDING nadal da się odwołać, bo maszyna stanów na to pozwala).
 */
const withCancelFlag = (booking: ClientBooking, now: Date) => ({
  ...booking,
  canCancel: canClientCancel(
    booking.status,
    booking.startsAt,
    booking.business.cancellationHours,
    now,
  ),
});

// Kto żąda przejścia — decyduje, czym jest „własna rezerwacja" (403) i czy obowiązuje
// polityka czasowa. Firma odwołuje zawsze, klient tylko w oknie (SDD §7).
type Actor = 'CLIENT' | 'BUSINESS';

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: BookingEventsService,
    private readonly payments: PaymentsService,
  ) {}

  /**
   * Moje wizyty (#28) — lista rezerwacji zalogowanego klienta w dwóch grupach, bo AC wymaga
   * przeciwnych sortowań: nadchodzące rosnąco (najbliższa u góry), minione malejąco
   * (ostatnia u góry). Dwa zapytania zamiast sortowania w pamięci — porządek ustala baza.
   *
   * Podział jest wyłącznie czasowy, po endsAt: wizyta trwająca właśnie teraz jest jeszcze
   * nadchodząca, a odwołana wizyta z jutra zostaje wśród nadchodzących ze swoim statusem
   * (front pokazuje badge per status — SDD §6). Status nie przenosi rezerwacji do historii.
   *
   * Dzielimy po endsAt, ale sortujemy po startsAt — celowo. Karta wizyty pokazuje godzinę
   * rozpoczęcia, więc porządek ma się zgadzać z tym, co klient widzi; sortowanie po polu
   * niewidocznym na liście wyglądałoby na błąd, gdyby oba czasy się rozjechały (możliwe
   * tylko przy nachodzących na siebie wizytach w dwóch różnych firmach).
   */
  async findMine(userId: string) {
    // Jeden znacznik czasu na całe wywołanie: ten sam dzieli listy i liczy canCancel, więc
    // rezerwacja nie może wpaść do „nadchodzących" z flagą policzoną na inną chwilę.
    const now = new Date();

    const [upcoming, past] = await Promise.all([
      this.prisma.booking.findMany({
        where: { clientId: userId, endsAt: { gt: now } },
        orderBy: { startsAt: 'asc' },
        select: clientBookingSelect,
      }),
      this.prisma.booking.findMany({
        where: { clientId: userId, endsAt: { lte: now } },
        orderBy: { startsAt: 'desc' },
        select: clientBookingSelect,
      }),
    ]);

    return {
      upcoming: upcoming.map((booking) => withCancelFlag(booking, now)),
      past: past.map((booking) => withCancelFlag(booking, now)),
    };
  }

  /**
   * Kalendarz firmy (#31) — rezerwacje w zakresie dat, dla właściciela (wszyscy pracownicy)
   * i pracownika z kontem (wyłącznie własne). from/to to lokalne daty firmy, nie instanty —
   * jak date w /availability; localDayRangeUtc daje granice doby odporne na zmianę czasu.
   * to liczymy z końca doby `to`, więc zapytanie jednodniowe (from === to) obejmuje całą dobę.
   *
   * Filtr employeeId jest wymuszony serwerowo dla pracownika — cokolwiek przyjdzie w query,
   * ignorujemy, bo AC #31 wprost tego wymaga (frontend nie ma się czym bronić przed
   * spreparowanym requestem).
   */
  async findForBusiness(user: AuthUser, query: BusinessBookingsQueryDto) {
    const from = localDayRangeUtc(parseLocalDate(query.from)).startUtc;
    const to = localDayRangeUtc(parseLocalDate(query.to)).endUtc;
    if (to <= from) {
      throw new BadRequestException('to musi być późniejsze niż from');
    }

    const where: Prisma.BookingWhereInput = {
      startsAt: { lt: to },
      endsAt: { gt: from },
    };

    if (user.role === UserRole.EMPLOYEE) {
      const employee = await this.prisma.employee.findUnique({
        where: { userId: user.sub },
        select: { id: true, businessId: true },
      });
      if (!employee) {
        throw new NotFoundException('Nie znaleziono pracownika');
      }
      where.businessId = employee.businessId;
      where.employeeId = employee.id;
    } else {
      const business = await this.prisma.business.findUnique({
        where: { ownerId: user.sub },
        select: { id: true },
      });
      if (!business) {
        throw new NotFoundException('Nie znaleziono firmy');
      }
      where.businessId = business.id;
      if (query.employeeId) {
        where.employeeId = query.employeeId;
      }
    }

    return this.prisma.booking.findMany({
      where,
      orderBy: { startsAt: 'asc' },
      select: businessBookingSelect,
    });
  }

  // decyzje firmy — dwa wejścia do tej samej maszyny stanów (SDD §7)
  confirm(userId: string, bookingId: string) {
    return this.transition(
      userId,
      bookingId,
      BookingStatus.CONFIRMED,
      'BUSINESS',
    );
  }

  decline(userId: string, bookingId: string) {
    return this.transition(
      userId,
      bookingId,
      BookingStatus.DECLINED,
      'BUSINESS',
    );
  }

  // Odwołania (#27). Ta sama maszyna stanów, inny aktor: klient odpowiada za własną
  // rezerwację i obowiązuje go okno z polityki firmy, firma odwołuje swoje bez ograniczeń.
  cancel(userId: string, bookingId: string) {
    return this.transition(
      userId,
      bookingId,
      BookingStatus.CANCELLED_BY_CLIENT,
      'CLIENT',
    );
  }

  cancelByBusiness(userId: string, bookingId: string) {
    return this.transition(
      userId,
      bookingId,
      BookingStatus.CANCELLED_BY_BUSINESS,
      'BUSINESS',
    );
  }

  /**
   * Przejście statusu pojedynczej rezerwacji na żądanie użytkownika — decyzje firmy (#26)
   * i odwołania (#27). Cron auto-COMPLETED (#39) potrzebuje operacji masowej („jeden
   * update, nie pętla per rekord"), więc omija tę metodę — siedzi w BookingCompletionService,
   * a zgodności z ALLOWED_TRANSITIONS pilnuje jego spec.
   *
   * Kolejność jest istotna: cokolwiek odpadnie na walidacji, odpada przed jedynym zapisem,
   * więc nieprawidłowe przejście nie zostawia po sobie żadnej zmiany (AC #26). Polityka
   * czasowa idzie po canTransition, żeby rezerwacja w stanie terminalnym dostała komunikat
   * o swoim stanie, a nie mylący komunikat o limicie godzin.
   */
  private async transition(
    userId: string,
    bookingId: string,
    to: BookingStatus,
    actor: Actor,
  ) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        status: true,
        clientId: true,
        startsAt: true,
        business: { select: { ownerId: true, cancellationHours: true } },
        payment: {
          select: { id: true, status: true, stripePaymentIntentId: true },
        },
      },
    });
    if (!booking) {
      throw new NotFoundException('Nie znaleziono rezerwacji');
    }
    // Cudza rezerwacja to 403, nie 404 — AC wprost tego wymaga, więc świadomie
    // odchodzimy od „cudze = 404" z ServicesService. „Cudza" znaczy co innego dla
    // każdego aktora: klienta wiąże clientId, firmę — właściciel firmy z rezerwacji.
    const isOwn =
      actor === 'CLIENT'
        ? booking.clientId === userId
        : booking.business.ownerId === userId;
    if (!isOwn) {
      throw new ForbiddenException('Brak uprawnień');
    }
    const from = booking.status;
    if (!canTransition(from, to)) {
      throw new ConflictException(
        `Rezerwacja jest ${STATUS_LABELS[from]} — nie można zmienić jej statusu`,
      );
    }
    // Nieopłaconej zaliczki nie da się potwierdzić (#51). Bez tego właściciel przyjąłby
    // wizytę, za którą nikt nie zapłacił, a cron i tak zwolniłby jej termin kwadrans później
    // — firma miałaby w kalendarzu potwierdzenie bez pokrycia.
    const unpaidDeposit = booking.payment?.status === PaymentStatus.PENDING;
    if (unpaidDeposit && to === BookingStatus.CONFIRMED) {
      throw new ConflictException('Rezerwacja czeka na opłacenie zaliczki');
    }

    // Okno odwołania dotyczy wyłącznie klienta — firma odwołuje zawsze (SDD §7).
    if (
      actor === 'CLIENT' &&
      !canClientCancel(
        from,
        booking.startsAt,
        booking.business.cancellationHours,
        new Date(),
      )
    ) {
      throw new ConflictException(
        cancellationWindowMessage(booking.business.cancellationHours),
      );
    }

    // status w WHERE zamyka wyścig między odczytem a zapisem: gdy ktoś w międzyczasie
    // ruszył rezerwację, warunek nie trafia i Prisma rzuca P2025 zamiast nadpisać cudzą
    // decyzję (where w update przyjmuje też pola nieunikalne obok klucza).
    const updated = await this.prisma.booking
      .update({
        where: { id: bookingId, status: from },
        data: { status: to },
        select: bookingSelect,
      })
      .catch((e: unknown) => {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2025'
        ) {
          throw new ConflictException(
            'Status rezerwacji zmienił się w międzyczasie',
          );
        }
        throw e;
      });

    // Rezerwacja przestała istnieć jako termin, a zaliczka wciąż czeka na zapłatę —
    // trzeba unieważnić PaymentIntent. Inaczej klient mógłby odwołać wizytę i zaraz potem
    // dokończyć płatność w otwartym formularzu Stripe'a, a my mielibyśmy pieniądze
    // za zwolniony slot. Zwroty już pobranych zaliczek to osobny temat (#52).
    if (unpaidDeposit && booking.payment) {
      await this.releaseDeposit({
        id: booking.payment.id,
        bookingId,
        stripePaymentIntentId: booking.payment.stripePaymentIntentId,
      });
    }

    // Dopiero po zatwierdzonym zapisie — stąd wychodzą maile z #37. Powiadomienie jest
    // efektem ubocznym, nie częścią operacji: rezerwacja jest już zmieniona, więc padnięta
    // wysyłka ma trafić do logu, a nie zamienić 200 w 500 (AC #37: „błąd wysyłki nie wywala
    // operacji na rezerwacji").
    this.notify(() => this.events.statusChanged(updated, from, to), updated.id);
    return updated;
  }

  /**
   * Unieważnienie nieopłaconej zaliczki przy okazji innej, już zapisanej operacji.
   * Best-effort z tego samego powodu, co notify(): zmiana statusu jest w bazie, więc błąd
   * Stripe'a ma trafić do logu, a nie zamienić udane odwołanie w 500. Nic się nie gubi —
   * płatność zostaje w PENDING, a cron wygaszania spróbuje ponownie.
   */
  private async releaseDeposit(payment: UnpaidPayment): Promise<void> {
    try {
      await this.payments.releaseUnpaid(payment);
    } catch (e) {
      this.logger.error(
        `Nie udało się unieważnić zaliczki ${payment.id}`,
        e instanceof Error ? e.stack : String(e),
      );
    }
  }

  /**
   * Zgłoszenie zdarzenia do powiadomień. Hook nigdy nie może przewrócić operacji, która
   * jest już zapisana — sam BookingEventsService oddaje wysyłkę w tło, więc tutaj łapiemy
   * wyłącznie błąd synchroniczny (np. gdyby hook rzucił przy budowaniu payloadu).
   */
  private notify(event: () => void, bookingId: string): void {
    try {
      event();
    } catch (e) {
      this.logger.error(
        `Nie udało się obsłużyć zdarzenia dla rezerwacji ${bookingId}`,
        e instanceof Error ? e.stack : String(e),
      );
    }
  }

  async create(userId: string, dto: CreateBookingDto) {
    const startsAt = new Date(dto.startsAt);

    // Warunki na sam czas — przed bazą, tak jak parseLocalDate w AvailabilityService.
    // /availability wystawia wyłącznie starty z siatki 15 min, więc cokolwiek innego
    // to ręcznie sklejony request, nie zniknięty slot → 400, nie 409.
    if (!isOnSlotGrid(startsAt)) {
      throw new BadRequestException(
        'startsAt musi być wielokrotnością 15 minut',
      );
    }
    if (startsAt <= new Date()) {
      throw new BadRequestException('startsAt musi być w przyszłości');
    }

    // Jedno zapytanie na cały scope: usługa aktywna, firma niezablokowana, a w środku
    // pracownik — aktywny i przypisany do tej usługi. Firma po relacji, nie po fetchu,
    // więc zablokowana i nieistniejąca dają identyczne 404 (jak w AvailabilityService).
    const service = await this.prisma.service.findFirst({
      where: {
        id: dto.serviceId,
        isActive: true,
        business: { isBlocked: false },
      },
      select: {
        businessId: true,
        durationMin: true,
        priceCents: true,
        depositType: true,
        depositValue: true,
        employees: {
          where: { id: dto.employeeId, isActive: true },
          select: { id: true },
        },
      },
    });
    if (!service) {
      throw new NotFoundException('Nie znaleziono usługi');
    }
    if (service.employees.length === 0) {
      throw new NotFoundException('Nie znaleziono pracownika');
    }

    // null = usługa bez zaliczki, płatna w całości na miejscu. Kwotę liczy helper z payments,
    // ten sam, którym waliduje się CRUD usług (#50) i który pokaże kwotę klientowi (#53) —
    // gdyby każde miejsce zaokrąglało procent po swojemu, klient widziałby inną sumę,
    // niż pobrałby Stripe.
    const depositCents = depositAmountCents(service);

    // Zanim cokolwiek trafi do bazy: rezerwacja, której nie da się opłacić, jest gorsza niż
    // brak rezerwacji — zablokowałaby slot do czasu wygaśnięcia. Usługi bez zaliczki nie
    // dotykają tej gałęzi w ogóle, więc działają jak dotąd także bez kluczy Stripe.
    if (depositCents !== null && !this.payments.isEnabled) {
      throw new ServiceUnavailableException(
        'Płatności online są chwilowo niedostępne',
      );
    }

    // długość wizyty zawsze z usługi — klient nie przysyła endsAt
    const endsAt = addMinutes(startsAt, service.durationMin);

    const created = await this.prisma.$transaction(async (tx) => {
      // Advisory lock na pracownika: od tego momentu do końca transakcji nikt inny nie
      // zapisuje jego rezerwacji, więc sprawdzenie poniżej jest autorytatywne. Bez tego
      // dwa równoległe requesty odczytałyby „wolne" i oba zapisały ten sam slot.
      // $executeRaw, nie $queryRaw — pg_advisory_xact_lock zwraca `void`, którego Prisma
      // nie umie zdeserializować („Failed to deserialize column of type 'void'").
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(
        ${BOOKING_LOCK_NAMESPACE}::int, hashtext(${dto.employeeId}::text)
      )`;

      // Grafik dnia lokalnego, w którym zaczyna się wizyta — weekday to pojęcie lokalne firmy.
      const localDate = utcToLocalDate(startsAt);
      const workingHours = await tx.workingHours.findMany({
        where: { employeeId: dto.employeeId, weekday: localWeekday(localDate) },
        select: { startTime: true, endTime: true },
      });
      const intervals: WorkInterval[] = workingHours.map((wh) => ({
        startUtc: zonedWallClockToUtc(localDate, wh.startTime),
        endUtc: zonedWallClockToUtc(localDate, wh.endTime),
      }));
      if (!fitsAnyInterval(startsAt, endsAt, intervals)) {
        throw new ConflictException(
          'Wybrany termin jest poza grafikiem pracownika',
        );
      }

      // Urlopy i cudze rezerwacje nachodzące na [startsAt, endsAt) — warunek nachodzenia
      // w WHERE, więc łapie też przedział rozpoczęty wcześniej. overlapsAny na wyniku
      // pilnuje, żeby definicja kolizji była wspólna z generateSlots (styk to nie kolizja).
      const [timeOffs, bookings] = await Promise.all([
        tx.timeOff.findMany({
          where: {
            employeeId: dto.employeeId,
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
          },
          select: { startsAt: true, endsAt: true },
        }),
        tx.booking.findMany({
          where: {
            employeeId: dto.employeeId,
            status: { in: BLOCKING_STATUSES },
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
          },
          select: { startsAt: true, endsAt: true },
        }),
      ]);
      if (overlapsAny(startsAt, endsAt, [...timeOffs, ...bookings])) {
        throw new ConflictException('Wybrany termin jest już zajęty');
      }

      // Status zostaje domyślny PENDING ze schematu — również dla rezerwacji z zaliczką.
      // PENDING jest w BLOCKING_STATUSES, więc slot blokuje się w chwili commitu i to samo
      // widzi /availability: „slot tymczasowo zablokowany" wychodzi bez osobnego stanu.
      // Wiersz Payment powstaje tu, w jednej transakcji z rezerwacją; identyfikatory ze
      // Stripe'a dopinamy niżej, po odpowiedzi z API.
      return tx.booking.create({
        data: {
          clientId: userId,
          businessId: service.businessId,
          employeeId: dto.employeeId,
          serviceId: dto.serviceId,
          startsAt,
          endsAt,
          clientNote: dto.clientNote ?? null,
          ...(depositCents === null
            ? {}
            : {
                payment: {
                  create: {
                    amountCents: depositCents,
                    currency: PAYMENT_CURRENCY,
                  },
                },
              }),
        },
        select: createdBookingSelect,
      });
    });

    const { payment, ...booking } = created;

    if (depositCents === null || !payment) {
      // Poza transakcją: firma dowiaduje się o rezerwacji dopiero wtedy, gdy ta na pewno
      // istnieje (rollback nie może wysłać maila o czymś, czego nie ma).
      this.notify(() => this.events.created(booking), booking.id);
      return { ...booking, payment: null };
    }

    // Maila do firmy tu celowo nie ma — wyśle go webhook po opłaceniu zaliczki. Inaczej
    // każdy porzucony checkout zgłaszałby firmie wizytę, która za kwadrans wygaśnie.
    return {
      ...booking,
      payment: await this.startDepositPayment(
        { id: payment.id, bookingId: booking.id, stripePaymentIntentId: null },
        depositCents,
        payment.createdAt,
      ),
    };
  }

  /**
   * PaymentIntent dla świeżo utworzonej rezerwacji. Wołany **po** commicie, nigdy w środku
   * transakcji: ta trzyma advisory lock na pracowniku, więc round-trip do Stripe'a
   * zablokowałby na ten czas wszystkie rezerwacje u tego samego pracownika.
   *
   * Gdy Stripe zawiedzie, slot wraca od razu — czekanie na crona trzymałoby kwadrans wolny
   * termin za rezerwację, o której klient już wie, że się nie udała.
   */
  private async startDepositPayment(
    payment: UnpaidPayment,
    amountCents: number,
    createdAt: Date,
  ) {
    let paymentIntentId: string | null = null;
    try {
      const intent = await this.payments.createDepositIntent(
        payment,
        amountCents,
      );
      paymentIntentId = intent.paymentIntentId;
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { stripePaymentIntentId: intent.paymentIntentId },
      });
      return {
        amountCents,
        currency: PAYMENT_CURRENCY,
        clientSecret: intent.clientSecret,
        expiresAt: paymentDeadline(createdAt),
      };
    } catch (e) {
      this.logger.error(
        `Nie udało się rozpocząć płatności dla rezerwacji ${payment.bookingId}`,
        e instanceof Error ? e.stack : String(e),
      );
      // paymentIntentId bywa już ustawione, gdy padł dopiero zapis do bazy — wtedy jest co
      // anulować po stronie Stripe'a.
      await this.releaseDeposit({
        ...payment,
        stripePaymentIntentId: paymentIntentId,
      });
      throw new ServiceUnavailableException(
        'Nie udało się rozpocząć płatności — spróbuj ponownie za chwilę',
      );
    }
  }
}
