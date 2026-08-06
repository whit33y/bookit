import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { authGuard } from '../core/auth/auth.guard';
import { settle } from '../public/testing-helpers';
import MyBookings from './my-bookings';

@Component({ selector: 'app-blank', template: '' })
class Blank {}

// jsdom nie implementuje showModal()/close() — ten sam lokalny polyfill co w
// shared/confirm-dialog.spec.ts; modal oceny renderuje się na tym ekranie
beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

const fakeJwt = (payload: object) =>
  `header.${btoa(JSON.stringify(payload))}.signature`;

const business = {
  id: 'biz1',
  slug: 'studio-fryzur',
  name: 'Studio Fryzur',
  phone: '123456789',
  street: 'Kwiatowa 1',
  city: 'Warszawa',
  postalCode: '00-001',
  cancellationHours: 24,
};

const review = {
  id: 'r1',
  rating: 5,
  comment: 'Bardzo miła obsługa',
  createdAt: '2026-08-04T09:00:00.000Z',
};

/** Zaliczka wizyty (#51) — null przy usłudze płatnej w całości na miejscu. */
const deposit = (status: string, amountCents = 6000) => ({
  status,
  amountCents,
});

const booking = (
  id: string,
  status: string,
  canCancel: boolean,
  serviceName: string,
  bookingReview: typeof review | null = null,
  payment: ReturnType<typeof deposit> | null = null,
) => ({
  id,
  startsAt: '2026-08-03T07:00:00.000Z',
  endsAt: '2026-08-03T07:30:00.000Z',
  status,
  clientNote: null,
  createdAt: '2026-07-01T10:00:00.000Z',
  business,
  service: {
    id: 's1',
    name: serviceName,
    description: null,
    durationMin: 30,
    priceCents: 7000,
  },
  employee: { id: 'e1', name: 'Anna Kowalska' },
  canCancel,
  review: bookingReview,
  payment,
});

const MOCK = {
  upcoming: [
    booking('b1', 'PENDING', true, 'Strzyżenie męskie'),
    // potwierdzona po terminie z polityki — backend zgasił flagę, front ma tylko wyjaśnić brak przycisku
    booking('b2', 'CONFIRMED', false, 'Koloryzacja'),
  ],
  past: [booking('b3', 'COMPLETED', false, 'Masaż')],
};

async function setup(response: unknown = MOCK, url = '/client') {
  localStorage.clear();
  localStorage.setItem(
    'bookit.accessToken',
    fakeJwt({ sub: 'u1', email: 'a@b.pl', role: 'CLIENT' }),
  );
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'login', component: Blank },
        { path: 'client', canActivate: [authGuard], component: MyBookings },
        { path: ':slug', component: Blank },
      ]),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });

  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url, MyBookings);
  const http = TestBed.inject(HttpTestingController);
  http.expectOne('/api/bookings/mine').flush(response);
  await settle(harness.fixture);
  harness.detectChanges();

  const el = () => harness.fixture.nativeElement as HTMLElement;
  const text = () => el().textContent ?? '';
  // „Odwołaj wizytę" albo „Odwoływanie…" — jeden przycisk w dwóch stanach
  const cancelButtons = () =>
    [...el().querySelectorAll<HTMLButtonElement>('button')].filter((b) =>
      /Odwoł(aj wizytę|ywanie)/.test(b.textContent ?? ''),
    );
  const tabs = () => [...el().querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const reviewButtons = () =>
    [...el().querySelectorAll<HTMLButtonElement>('button')].filter(
      (b) => b.textContent?.trim() === 'Oceń wizytę',
    );
  const dialog = () => el().querySelector('dialog') as HTMLDialogElement;
  const dialogOpen = () => dialog().hasAttribute('open');

  const click = async (button: HTMLButtonElement) => {
    button.click();
    await settle(harness.fixture);
    harness.detectChanges();
  };

  const rateBooking = async (rating: number, comment?: string) => {
    await click(reviewButtons()[0]);
    const stars = [...dialog().querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    stars[rating - 1].click();
    if (comment !== undefined) {
      const field = dialog().querySelector('#review-comment') as HTMLTextAreaElement;
      field.value = comment;
      field.dispatchEvent(new Event('input'));
    }
    await settle(harness.fixture);
    harness.detectChanges();

    const send = [...dialog().querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('Wyślij ocenę'),
    );
    send?.click();
    await settle(harness.fixture);
    harness.detectChanges();
  };

  return {
    harness,
    http,
    el,
    text,
    cancelButtons,
    tabs,
    click,
    reviewButtons,
    dialog,
    dialogOpen,
    rateBooking,
  };
}

describe('MyBookings', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    vi.restoreAllMocks();
  });

  it('pokazuje nadchodzące wizyty z polskimi statusami, historia siedzi w drugiej zakładce', async () => {
    const ctx = await setup();

    expect(ctx.tabs().map((t) => t.textContent?.trim())).toEqual([
      'Nadchodzące (2)',
      'Historia (1)',
    ]);
    expect(ctx.text()).toContain('Oczekująca');
    expect(ctx.text()).toContain('Potwierdzona');
    expect(ctx.text()).toContain('Strzyżenie męskie');
    expect(ctx.text()).not.toContain('Masaż');

    await ctx.click(ctx.tabs()[1]);

    expect(ctx.text()).toContain('Zakończona');
    expect(ctx.text()).toContain('Masaż');
    expect(ctx.text()).not.toContain('Strzyżenie męskie');
  });

  it('strzałka przełącza zakładkę i przenosi focus (roving tabindex)', async () => {
    const ctx = await setup();

    ctx.tabs()[0].focus();
    ctx.tabs()[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    await settle(ctx.harness.fixture);
    ctx.harness.detectChanges();

    expect(ctx.tabs()[1].getAttribute('aria-selected')).toBe('true');
    expect(ctx.tabs()[1].tabIndex).toBe(0);
    expect(ctx.tabs()[0].tabIndex).toBe(-1);
    expect(document.activeElement).toBe(ctx.tabs()[1]);
    expect(ctx.text()).toContain('Masaż');
  });

  it('przycisk „odwołaj" tylko przy canCancel; reszta dostaje wyjaśnienie polityki', async () => {
    const ctx = await setup();

    expect(ctx.cancelButtons()).toHaveLength(1);
    expect(ctx.text()).toContain('najpóźniej 24 h przed terminem');
  });

  it('rezygnacja z potwierdzenia nie wysyła żadnego zapytania', async () => {
    const ctx = await setup();
    vi.spyOn(globalThis, 'confirm').mockReturnValue(false);

    await ctx.click(ctx.cancelButtons()[0]);

    // wiszący request wywróciłby verify() w afterEach
    expect(ctx.text()).toContain('Oczekująca');
  });

  it('po potwierdzeniu odwołuje wizytę i odświeża status bez przeładowania listy', async () => {
    const ctx = await setup();
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);

    await ctx.click(ctx.cancelButtons()[0]);

    const req = ctx.http.expectOne('/api/bookings/b1/cancel');
    expect(req.request.method).toBe('POST');
    req.flush({ id: 'b1', status: 'CANCELLED_BY_CLIENT' });
    await settle(ctx.harness.fixture);
    ctx.harness.detectChanges();

    expect(ctx.text()).toContain('Odwołana przez Ciebie');
    expect(ctx.text()).not.toContain('Oczekująca');
    // status podmieniony w sygnale — brak ponownego GET /bookings/mine (verify() to pilnuje)
    expect(ctx.cancelButtons()).toHaveLength(0);
  });

  it('dwa równoległe odwołania: odpowiedź na pierwsze nie odblokowuje drugiego', async () => {
    const ctx = await setup({
      upcoming: [
        booking('b1', 'PENDING', true, 'Strzyżenie męskie'),
        booking('b2', 'PENDING', true, 'Koloryzacja'),
      ],
      past: [],
    });
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);

    await ctx.click(ctx.cancelButtons()[0]);
    await ctx.click(ctx.cancelButtons()[1]);

    // pierwsze odwołanie kończy się, drugie wciąż leci
    ctx.http
      .expectOne('/api/bookings/b1/cancel')
      .flush({ id: 'b1', status: 'CANCELLED_BY_CLIENT' });
    await settle(ctx.harness.fixture);
    ctx.harness.detectChanges();

    const pending = ctx.cancelButtons();
    expect(pending).toHaveLength(1);
    expect(pending[0].disabled).toBe(true);
    expect(pending[0].textContent?.trim()).toBe('Odwoływanie…');

    ctx.http
      .expectOne('/api/bookings/b2/cancel')
      .flush({ id: 'b2', status: 'CANCELLED_BY_CLIENT' });
    await settle(ctx.harness.fixture);
    ctx.harness.detectChanges();

    expect(ctx.cancelButtons()).toHaveLength(0);
  });

  it('409 przy odwołaniu: komunikat backendu i świeża lista', async () => {
    const ctx = await setup();
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);

    await ctx.click(ctx.cancelButtons()[0]);

    ctx.http.expectOne('/api/bookings/b1/cancel').flush(
      {
        statusCode: 409,
        code: 'CONFLICT',
        message: 'Rezerwację można odwołać najpóźniej 24 godziny przed wizytą',
      },
      { status: 409, statusText: 'Conflict' },
    );
    await settle(ctx.harness.fixture);

    // rozjazd ze stanem serwera — lista jest pobierana ponownie
    ctx.http.expectOne('/api/bookings/mine').flush({
      upcoming: [booking('b1', 'CONFIRMED', false, 'Strzyżenie męskie')],
      past: [],
    });
    await settle(ctx.harness.fixture);
    ctx.harness.detectChanges();

    expect(ctx.text()).toContain(
      'Rezerwację można odwołać najpóźniej 24 godziny przed wizytą',
    );
    expect(ctx.cancelButtons()).toHaveLength(0);
  });

  it('pusta lista: komunikat zamiast kart', async () => {
    const ctx = await setup({ upcoming: [], past: [] });

    expect(ctx.text()).toContain('Nie masz zaplanowanych wizyt');
  });

  it('potwierdzona wizyta w historii nie dostaje rady o polityce odwołań', async () => {
    // CONFIRMED z przeszłości: cron domykający do COMPLETED (#39) jeszcze nie istnieje
    const ctx = await setup({
      upcoming: [],
      past: [booking('b9', 'CONFIRMED', false, 'Masaż')],
    });

    await ctx.click(ctx.tabs()[1]);

    expect(ctx.text()).toContain('Masaż');
    expect(ctx.text()).not.toContain('przed terminem');
  });

  it('„oceń wizytę" tylko przy zakończonej wizycie bez recenzji', async () => {
    const ctx = await setup({
      upcoming: [booking('b1', 'CONFIRMED', true, 'Strzyżenie męskie')],
      past: [
        booking('b3', 'COMPLETED', false, 'Masaż'),
        booking('b4', 'COMPLETED', false, 'Koloryzacja', review),
        booking('b5', 'CANCELLED_BY_CLIENT', false, 'Trymowanie brody'),
      ],
    });

    // nadchodząca wizyta jeszcze się nie odbyła — nie ma czego oceniać
    expect(ctx.reviewButtons()).toHaveLength(0);

    await ctx.click(ctx.tabs()[1]);

    expect(ctx.reviewButtons()).toHaveLength(1);
    // wizyta z recenzją pokazuje ocenę zamiast akcji
    expect(ctx.text()).toContain('Twoja ocena');
    expect(ctx.text()).toContain('Bardzo miła obsługa');
    expect(ctx.el().querySelector('[aria-label="Ocena 5 na 5"]')).not.toBeNull();
  });

  it('wystawia ocenę i podmienia kartę bez przeładowania listy', async () => {
    const ctx = await setup({
      upcoming: [],
      past: [booking('b3', 'COMPLETED', false, 'Masaż')],
    });

    await ctx.click(ctx.tabs()[1]);
    await ctx.rateBooking(4, 'Polecam');

    const req = ctx.http.expectOne('/api/bookings/b3/review');
    expect(req.request.method).toBe('POST');
    // bookingId siedzi w ścieżce; w body wywróciłby ValidationPipe z forbidNonWhitelisted
    expect(req.request.body).toEqual({ rating: 4, comment: 'Polecam' });
    req.flush({
      id: 'r9',
      bookingId: 'b3',
      businessId: 'biz1',
      rating: 4,
      comment: 'Polecam',
      createdAt: '2026-08-05T10:00:00.000Z',
    });
    await settle(ctx.harness.fixture);
    ctx.harness.detectChanges();

    // AC: akcja znika, ocena widoczna, brak ponownego GET /bookings/mine (pilnuje verify())
    expect(ctx.reviewButtons()).toHaveLength(0);
    expect(ctx.dialogOpen()).toBe(false);
    expect(ctx.text()).toContain('Twoja ocena');
    expect(ctx.text()).toContain('Polecam');
    expect(ctx.el().querySelector('[aria-label="Ocena 4 na 5"]')).not.toBeNull();
  });

  it('ocena bez komentarza nie wysyła pustego pola', async () => {
    const ctx = await setup({
      upcoming: [],
      past: [booking('b3', 'COMPLETED', false, 'Masaż')],
    });

    await ctx.click(ctx.tabs()[1]);
    await ctx.rateBooking(5);

    const req = ctx.http.expectOne('/api/bookings/b3/review');
    expect(req.request.body).toEqual({ rating: 5 });
    req.flush({
      id: 'r9',
      bookingId: 'b3',
      businessId: 'biz1',
      rating: 5,
      comment: null,
      createdAt: '2026-08-05T10:00:00.000Z',
    });
    await settle(ctx.harness.fixture);
    ctx.harness.detectChanges();

    expect(ctx.reviewButtons()).toHaveLength(0);
  });

  it('409 przy ocenie: komunikat w modalu i świeża lista', async () => {
    const ctx = await setup({
      upcoming: [],
      past: [booking('b3', 'COMPLETED', false, 'Masaż')],
    });

    await ctx.click(ctx.tabs()[1]);
    await ctx.rateBooking(3);

    ctx.http.expectOne('/api/bookings/b3/review').flush(
      {
        statusCode: 409,
        code: 'CONFLICT',
        message: 'Ta wizyta ma już recenzję',
      },
      { status: 409, statusText: 'Conflict' },
    );
    await settle(ctx.harness.fixture);

    // recenzja powstała poza tą kartą — lista pokazuje nieprawdę, więc bierzemy świeżą
    ctx.http.expectOne('/api/bookings/mine').flush({
      upcoming: [],
      past: [booking('b3', 'COMPLETED', false, 'Masaż', review)],
    });
    await settle(ctx.harness.fixture);
    ctx.harness.detectChanges();

    expect(ctx.dialog().textContent).toContain('Ta wizyta ma już recenzję');
    expect(ctx.reviewButtons()).toHaveLength(0);
    expect(ctx.text()).toContain('Twoja ocena');
  });

  it('błąd pobrania listy: komunikat i ponowna próba zamiast „nie masz wizyt"', async () => {
    localStorage.clear();
    localStorage.setItem(
      'bookit.accessToken',
      fakeJwt({ sub: 'u1', email: 'a@b.pl', role: 'CLIENT' }),
    );
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'client', canActivate: [authGuard], component: MyBookings },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/client', MyBookings);
    const http = TestBed.inject(HttpTestingController);
    http
      .expectOne('/api/bookings/mine')
      .flush('', { status: 500, statusText: 'Server Error' });
    await settle(harness.fixture);
    harness.detectChanges();

    const el = harness.fixture.nativeElement as HTMLElement;
    expect(el.textContent).not.toContain('Nie masz zaplanowanych wizyt');

    const retry = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('Spróbuj ponownie'),
    );
    retry?.click();
    await settle(harness.fixture);

    http.expectOne('/api/bookings/mine').flush({ upcoming: [], past: [] });
    await settle(harness.fixture);
    harness.detectChanges();

    expect((harness.fixture.nativeElement as HTMLElement).textContent).toContain(
      'Nie masz zaplanowanych wizyt',
    );
  });

  // ── #53: stan zaliczki na karcie wizyty ────────────────────────────────
  describe('zaliczka', () => {
    /** Karta jednej wizyty z zaliczką w podanym stanie, ze znormalizowaną twardą spacją. */
    const cardWith = async (paymentStatus: string) => {
      const ctx = await setup({
        upcoming: [
          booking(
            'b1',
            'PENDING',
            true,
            'Koloryzacja',
            null,
            deposit(paymentStatus),
          ),
        ],
        past: [],
      });
      return (ctx.text() ?? '').replace(/\s/g, ' ');
    };

    it('opłacona zaliczka: kwota i stan przy wizycie', async () => {
      const card = await cardWith('SUCCEEDED');

      expect(card).toContain('Zaliczka');
      expect(card).toContain('60 zł');
      expect(card).toContain('opłacona');
    });

    it('nieopłacona zaliczka mówi, że czeka na płatność', async () => {
      expect(await cardWith('PENDING')).toContain('oczekuje na opłacenie');
    });

    it('nieudana płatność nazywa rzecz po imieniu', async () => {
      expect(await cardWith('FAILED')).toContain('płatność nieudana');
    });

    it('wygasła rezerwacja: zaliczka niepobrana, nie „nieudana"', async () => {
      expect(await cardWith('CANCELLED')).toContain(
        'niepobrana — rezerwacja wygasła',
      );
    });

    // REFUNDED zacznie zwracać backend dopiero w #52 — etykieta czeka gotowa, żeby zwrot
    // nie wylądował wtedy w pustej komórce
    it('zwrócona zaliczka ma etykietę gotową na #52', async () => {
      expect(await cardWith('REFUNDED')).toContain('zwrócona');
    });

    it('usługa bez zaliczki nie dokłada wiersza', async () => {
      const ctx = await setup({
        upcoming: [booking('b1', 'PENDING', true, 'Strzyżenie męskie')],
        past: [],
      });

      expect(ctx.text()).not.toContain('Zaliczka');
    });
  });

  // deep-link z powiadomienia in-app (#54): „klik prowadzi do wizyty"
  describe('?booking=', () => {
    const card = (ctx: Awaited<ReturnType<typeof setup>>, id: string) =>
      ctx.el().querySelector(`#booking-${id}`);

    it('wskazana wizyta z historii przełącza zakładkę i podświetla kartę', async () => {
      const ctx = await setup(MOCK, '/client?booking=b3');

      expect(ctx.tabs()[1].getAttribute('aria-selected')).toBe('true');
      expect(ctx.text()).toContain('Masaż');
      expect(card(ctx, 'b3')?.className).toContain('ring-brand-600');
      // podświetlona jest dokładnie jedna karta
      expect(ctx.el().querySelectorAll('.ring-brand-600')).toHaveLength(1);
    });

    it('wskazana wizyta zostaje wyfokusowana — użytkownik klawiatury trafia do celu', async () => {
      const ctx = await setup(MOCK, '/client?booking=b3');

      expect(document.activeElement).toBe(card(ctx, 'b3'));
    });

    it('nadchodząca wizyta zostaje w pierwszej zakładce', async () => {
      const ctx = await setup(MOCK, '/client?booking=b2');

      expect(ctx.tabs()[0].getAttribute('aria-selected')).toBe('true');
      expect(card(ctx, 'b2')?.className).toContain('ring-brand-600');
    });

    it('nieznane id nie psuje widoku ani nie zmienia zakładki', async () => {
      const ctx = await setup(MOCK, '/client?booking=nie-ma-takiej');

      expect(ctx.tabs()[0].getAttribute('aria-selected')).toBe('true');
      expect(ctx.text()).toContain('Strzyżenie męskie');
      expect(ctx.el().querySelectorAll('.ring-brand-600')).toHaveLength(0);
    });
  });

  it('authGuard: niezalogowany trafia na /login z returnUrl', async () => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'login', component: Blank },
          { path: 'client', canActivate: [authGuard], component: MyBookings },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/client');

    // brak zapytania o wizyty — komponent w ogóle się nie utworzył
    const url = TestBed.inject(Router).url;
    expect(url).toContain('/login');
    expect(decodeURIComponent(url)).toContain('returnUrl=/client');
  });
});
