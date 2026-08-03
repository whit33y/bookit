import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { StripeLoader } from '../../shared/payments/stripe-loader';
import { settle } from '../testing-helpers';
import BookingWizard, { groupSlotsByStart } from './booking-wizard';

const fakeJwt = (payload: object) =>
  `header.${btoa(JSON.stringify(payload))}.signature`;

@Component({ selector: 'app-blank', template: '' })
class Blank {}

const MOCK = {
  id: 'b1',
  slug: 'test-slug',
  name: 'Studio Fryzur',
  services: [
    {
      id: 's1',
      name: 'Strzyżenie męskie',
      description: null,
      durationMin: 30,
      priceCents: 7000,
      depositType: null,
      depositValue: null,
      employees: [
        { id: 'e1', name: 'Anna Kowalska' },
        { id: 'e2', name: 'Bartosz Nowak' },
      ],
    },
    {
      // usługa z zaliczką (#50): 30% z 200 zł = 60 zł, jak „Koloryzacja" w danych demo
      id: 's2',
      name: 'Koloryzacja',
      description: null,
      durationMin: 90,
      priceCents: 20000,
      depositType: 'PERCENT',
      depositValue: 30,
      employees: [{ id: 'e3', name: 'Celina Wiśniewska' }],
    },
  ],
};

// 07:00Z w sierpniu = 09:00 w Europe/Warsaw (UTC+2)
const SLOT_A = '2026-08-03T07:00:00.000Z';
const SLOT_B = '2026-08-03T07:30:00.000Z';
const DATE = '2026-08-03';

/** querySelector z czytelnym błędem zamiast `!` — brak elementu ma wskazać selektor. */
function must<T extends Element>(root: HTMLElement, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) {
    throw new Error(`Brak elementu w widoku: ${selector}`);
  }
  return found;
}

/** Natywny date input emituje 'change', nie 'input' — stąd własny helper zamiast setValue. */
const setDate = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event('change'));
};

/** Atrapa Stripe.js — kreator z zaliczką montuje krok płatności, a prawdziwe SDK
 *  ładuje skrypt z js.stripe.com, którego jsdom nigdy nie doczeka. */
function fakeStripe() {
  const confirmPayment = vi
    .fn()
    .mockResolvedValue({ paymentIntent: { status: 'succeeded' } });
  const retrievePaymentIntent = vi
    .fn()
    .mockResolvedValue({ paymentIntent: { status: 'succeeded' } });
  const stripe = {
    elements: vi.fn(() => ({ create: vi.fn(() => ({ mount: vi.fn() })) })),
    confirmPayment,
    retrievePaymentIntent,
  };
  return { stripe, confirmPayment, retrievePaymentIntent };
}

async function setup(query = '?serviceId=s1', loggedIn = false, stripe = fakeStripe()) {
  localStorage.clear();
  if (loggedIn) {
    localStorage.setItem(
      'bookit.accessToken',
      fakeJwt({ sub: 'u1', email: 'a@b.pl', role: 'CLIENT' }),
    );
  }
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'login', component: Blank },
        { path: 'client', component: Blank },
        {
          path: ':slug',
          children: [
            { path: '', component: Blank },
            { path: 'rezerwacja', component: BookingWizard },
          ],
        },
      ]),
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: StripeLoader,
        useValue: { load: vi.fn().mockResolvedValue(stripe.stripe) },
      },
    ],
  });

  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl('/test-slug/rezerwacja' + query, BookingWizard);
  const http = TestBed.inject(HttpTestingController);
  http.expectOne('/api/businesses/test-slug').flush(MOCK);
  await settle(harness.fixture);
  harness.detectChanges();

  const el = () => harness.fixture.nativeElement as HTMLElement;
  // Intl wstawia w „60 zł" twardą spację — normalizacja jak w business-profile.spec.ts
  const text = () => (el().textContent ?? '').replace(/\s/g, ' ');
  const availability = () =>
    http.expectOne((r) =>
      r.url.startsWith('/api/businesses/test-slug/availability'),
    );

  return { harness, http, el, text, availability, stripe };
}

/** Wybiera „Dowolny pracownik" + dzień i zwraca zapytanie o sloty. */
async function pickAnyEmployeeAndDate(ctx: Awaited<ReturnType<typeof setup>>) {
  const radios = ctx.el().querySelectorAll<HTMLInputElement>('input[type="radio"]');
  radios[0].click();
  await settle(ctx.harness.fixture);
  ctx.harness.detectChanges();

  setDate(must<HTMLInputElement>(ctx.el(), '#data'), DATE);
  await settle(ctx.harness.fixture);
  return ctx.availability();
}

/** flush + rozliczenie łańcucha promisów + odświeżenie widoku. */
async function flushSlots(
  ctx: Awaited<ReturnType<typeof setup>>,
  req: { flush: (body: unknown) => void },
  slots: unknown[],
) {
  req.flush(slots);
  await settle(ctx.harness.fixture);
  ctx.harness.detectChanges();
}

const slotButtons = (el: HTMLElement) =>
  [
    ...el.querySelectorAll<HTMLButtonElement>(
      'section[aria-labelledby="krok-3"] ul button',
    ),
  ];

describe('groupSlotsByStart', () => {
  it('scala sloty o tej samej godzinie i zostawia pierwszego pracownika', () => {
    const grouped = groupSlotsByStart([
      { employeeId: 'e1', startsAt: SLOT_A },
      { employeeId: 'e2', startsAt: SLOT_A },
      { employeeId: 'e2', startsAt: SLOT_B },
    ]);

    expect(grouped).toEqual([
      { employeeId: 'e1', startsAt: SLOT_A },
      { employeeId: 'e2', startsAt: SLOT_B },
    ]);
  });
});

describe('BookingWizard', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('krok 2 pokazuje tylko pracowników wybranej usługi + „dowolny"', async () => {
    const { text } = await setup('?serviceId=s1');

    expect(text()).toContain('Dowolny pracownik');
    expect(text()).toContain('Anna Kowalska');
    expect(text()).toContain('Bartosz Nowak');
    // pracownik przypisany wyłącznie do innej usługi nie może się tu pojawić
    expect(text()).not.toContain('Celina Wiśniewska');
  });

  it('„dowolny" pyta o sloty bez employeeId i scala te same godziny w jeden przycisk', async () => {
    const ctx = await setup('?serviceId=s1');
    const req = await pickAnyEmployeeAndDate(ctx);

    expect(req.request.url).toContain('serviceId=s1');
    expect(req.request.url).toContain('date=' + DATE);
    expect(req.request.url).not.toContain('employeeId');

    await flushSlots(ctx, req, [
      { employeeId: 'e1', startsAt: SLOT_A },
      { employeeId: 'e2', startsAt: SLOT_A },
      { employeeId: 'e2', startsAt: SLOT_B },
    ]);

    const buttons = slotButtons(ctx.el());
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['09:00', '09:30']);
  });

  it('konkretny pracownik trafia do zapytania o sloty', async () => {
    const ctx = await setup('?serviceId=s1');
    const radios = ctx
      .el()
      .querySelectorAll<HTMLInputElement>('input[type="radio"]');
    radios[1].click(); // Anna Kowalska
    await settle(ctx.harness.fixture);
    ctx.harness.detectChanges();

    setDate(must<HTMLInputElement>(ctx.el(), '#data'), DATE);
    await settle(ctx.harness.fixture);

    const req = ctx.availability();
    expect(req.request.url).toContain('employeeId=e1');
    await flushSlots(ctx, req, []);

    expect(ctx.text()).toContain('Brak wolnych terminów w tym dniu.');
  });

  it('spóźniona odpowiedź na poprzedni dzień nie nadpisuje aktualnych slotów', async () => {
    const ctx = await setup('?serviceId=s1');
    ctx.el().querySelectorAll<HTMLInputElement>('input[type="radio"]')[0].click();
    await settle(ctx.harness.fixture);
    ctx.harness.detectChanges();

    setDate(must<HTMLInputElement>(ctx.el(), '#data'), DATE);
    await settle(ctx.harness.fixture);
    setDate(must<HTMLInputElement>(ctx.el(), '#data'), '2026-08-04');
    await settle(ctx.harness.fixture);

    const requests = ctx.http.match((r) =>
      r.url.startsWith('/api/businesses/test-slug/availability'),
    );
    expect(requests).toHaveLength(2);

    // nowsze zapytanie odpowiada pierwsze, spóźnione starsze zaraz po nim
    requests[1].flush([{ employeeId: 'e1', startsAt: SLOT_B }]);
    await settle(ctx.harness.fixture);
    requests[0].flush([{ employeeId: 'e1', startsAt: SLOT_A }]);
    await settle(ctx.harness.fixture);
    ctx.harness.detectChanges();

    expect(slotButtons(ctx.el()).map((b) => b.textContent?.trim())).toEqual([
      '09:30',
    ]);
  });

  it('sukces: ekran potwierdzenia ze statusem oczekiwania na firmę', async () => {
    const ctx = await setup('?serviceId=s1', true);
    await flushSlots(ctx, await pickAnyEmployeeAndDate(ctx), [
      { employeeId: 'e1', startsAt: SLOT_A },
    ]);

    slotButtons(ctx.el())[0].click();
    await settle(ctx.harness.fixture);
    ctx.harness.detectChanges();

    must<HTMLButtonElement>(ctx.el(), '.btn-primary').click();
    await settle(ctx.harness.fixture);

    const post = ctx.http.expectOne('/api/bookings');
    expect(post.request.body).toEqual({
      serviceId: 's1',
      employeeId: 'e1',
      startsAt: SLOT_A,
    });
    post.flush({
      id: 'bk1',
      employeeId: 'e1',
      serviceId: 's1',
      startsAt: SLOT_A,
      endsAt: SLOT_B,
      status: 'PENDING',
      payment: null,
    });
    await settle(ctx.harness.fixture);
    ctx.harness.detectChanges();

    expect(ctx.text()).toContain('Rezerwacja przyjęta');
    expect(ctx.text()).toContain('Oczekuje na akceptację firmy');
    expect(ctx.text()).toContain('Anna Kowalska');
  });

  it('409 przy zapisie: komunikat i odświeżenie slotów', async () => {
    const ctx = await setup('?serviceId=s1', true);
    await flushSlots(ctx, await pickAnyEmployeeAndDate(ctx), [
      { employeeId: 'e1', startsAt: SLOT_A },
      { employeeId: 'e1', startsAt: SLOT_B },
    ]);

    slotButtons(ctx.el())[0].click();
    await settle(ctx.harness.fixture);
    ctx.harness.detectChanges();

    must<HTMLButtonElement>(ctx.el(), '.btn-primary').click();
    await settle(ctx.harness.fixture);

    ctx.http.expectOne('/api/bookings').flush(
      { statusCode: 409, code: 'CONFLICT', message: 'Wybrany termin jest już zajęty' },
      { status: 409, statusText: 'Conflict' },
    );
    await settle(ctx.harness.fixture);

    // po konflikcie lista slotów jest przeładowywana — zajęty termin znika
    await flushSlots(ctx, ctx.availability(), [
      { employeeId: 'e1', startsAt: SLOT_B },
    ]);

    expect(ctx.text()).toContain('Wybrany termin jest już zajęty');
    expect(slotButtons(ctx.el()).map((b) => b.textContent?.trim())).toEqual([
      '09:30',
    ]);
    // wybór wyczyszczony → podsumowanie i przycisk zapisu znikają
    expect(ctx.text()).not.toContain('Podsumowanie');
  });

  it('niezalogowany trafia na /login z returnUrl prowadzącym z powrotem do wizarda', async () => {
    const ctx = await setup('?serviceId=s1', false);
    await flushSlots(ctx, await pickAnyEmployeeAndDate(ctx), [
      { employeeId: 'e1', startsAt: SLOT_A },
    ]);

    slotButtons(ctx.el())[0].click();
    await settle(ctx.harness.fixture);
    ctx.harness.detectChanges();

    must<HTMLButtonElement>(ctx.el(), '.btn-primary').click();
    await settle(ctx.harness.fixture);

    const url = TestBed.inject(Router).url;
    expect(url).toContain('/login');
    const returnUrl = decodeURIComponent(
      new URLSearchParams(url.slice(url.indexOf('?'))).get('returnUrl') ?? '',
    );
    expect(returnUrl).toContain('/test-slug/rezerwacja');
    expect(returnUrl).toContain('serviceId=s1');
    expect(returnUrl).toContain('employeeId=any');
    expect(returnUrl).toContain('startsAt=' + SLOT_A);
  });

  it('po 409 zmiana dnia czyści komunikat o konflikcie', async () => {
    const ctx = await setup('?serviceId=s1', true);
    await flushSlots(ctx, await pickAnyEmployeeAndDate(ctx), [
      { employeeId: 'e1', startsAt: SLOT_A },
    ]);

    slotButtons(ctx.el())[0].click();
    await settle(ctx.harness.fixture);
    ctx.harness.detectChanges();

    must<HTMLButtonElement>(ctx.el(), '.btn-primary').click();
    await settle(ctx.harness.fixture);
    ctx.http
      .expectOne('/api/bookings')
      .flush(
        { statusCode: 409, code: 'CONFLICT', message: 'Wybrany termin jest już zajęty' },
        { status: 409, statusText: 'Conflict' },
      );
    await settle(ctx.harness.fixture);
    await flushSlots(ctx, ctx.availability(), []);
    expect(ctx.text()).toContain('Wybrany termin jest już zajęty');

    setDate(must<HTMLInputElement>(ctx.el(), '#data'), '2026-08-04');
    await settle(ctx.harness.fixture);
    await flushSlots(ctx, ctx.availability(), [
      { employeeId: 'e1', startsAt: SLOT_B },
    ]);

    expect(ctx.text()).not.toContain('Wybrany termin jest już zajęty');
  });

  it('nieaktualna usługa z adresu cofa wizard do kroku 1 zamiast pytać o sloty', async () => {
    const ctx = await setup(`?serviceId=NIEMA&employeeId=e1&date=${DATE}`);

    // brak zapytania o sloty — afterEach verify() wyłapałby wiszący request
    expect(ctx.text()).toContain('Krok 1 z 3');
    expect(ctx.text()).not.toContain('Wybierz termin');
  });

  it('pracownik odpięty od usługi wraca do kroku 2', async () => {
    const ctx = await setup(`?serviceId=s1&employeeId=e3&date=${DATE}`);

    expect(ctx.text()).toContain('Krok 2 z 3');
    expect(ctx.text()).not.toContain('Wybierz termin');
  });

  it('notatka wraca razem z resztą wyboru po logowaniu', async () => {
    const ctx = await setup('?serviceId=s1', false);
    await flushSlots(ctx, await pickAnyEmployeeAndDate(ctx), [
      { employeeId: 'e1', startsAt: SLOT_A },
    ]);

    slotButtons(ctx.el())[0].click();
    await settle(ctx.harness.fixture);
    ctx.harness.detectChanges();

    const note = must<HTMLTextAreaElement>(ctx.el(), '#notatka');
    note.value = 'Proszę o krótsze boki';
    note.dispatchEvent(new Event('input'));
    await settle(ctx.harness.fixture);

    must<HTMLButtonElement>(ctx.el(), '.btn-primary').click();
    await settle(ctx.harness.fixture);

    const url = TestBed.inject(Router).url;
    const returnUrl = new URLSearchParams(url.slice(url.indexOf('?'))).get(
      'returnUrl',
    );
    expect(returnUrl).toContain('clientNote=Prosz');
  });

  it('odtwarza stan z adresu po powrocie z logowania', async () => {
    const ctx = await setup(
      `?serviceId=s1&employeeId=e1&date=${DATE}&startsAt=${encodeURIComponent(SLOT_A)}`,
      true,
    );

    const req = ctx.availability();
    expect(req.request.url).toContain('employeeId=e1');
    await flushSlots(ctx, req, [{ employeeId: 'e1', startsAt: SLOT_A }]);

    // wybrany termin przetrwał logowanie → od razu widać podsumowanie
    expect(ctx.text()).toContain('Podsumowanie');
    expect(ctx.text()).toContain('Anna Kowalska');
  });

  // ── #53: zaliczka ──────────────────────────────────────────────────────
  describe('usługa z zaliczką', () => {
    const SLOT_C = '2026-08-03T08:00:00.000Z';

    /** Doprowadza kreator do wysłania POST /bookings dla usługi s2 (zaliczka 60 zł). */
    async function bookWithDeposit(ctx: Awaited<ReturnType<typeof setup>>) {
      await flushSlots(ctx, await pickAnyEmployeeAndDate(ctx), [
        { employeeId: 'e3', startsAt: SLOT_C },
      ]);

      slotButtons(ctx.el())[0].click();
      await settle(ctx.harness.fixture);
      ctx.harness.detectChanges();

      must<HTMLButtonElement>(ctx.el(), '.btn-primary').click();
      await settle(ctx.harness.fixture);
      return ctx.http.expectOne('/api/bookings');
    }

    const paymentBody = {
      id: 'bk2',
      employeeId: 'e3',
      serviceId: 's2',
      startsAt: SLOT_C,
      endsAt: SLOT_C,
      status: 'PENDING',
      payment: {
        amountCents: 6000,
        currency: 'pln',
        clientSecret: 'pi_2_secret_x',
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      },
    };

    it('kwota zaliczki widoczna już przy wyborze usługi', async () => {
      const { text } = await setup('?serviceId=s1');

      // s2 ma 30% z 200 zł; s1 bez zaliczki nie dostaje żadnej etykiety
      expect(text()).toContain('Zaliczka 60 zł online');
      expect(text()).not.toContain('Zaliczka 0 zł');
    });

    it('licznik kroków rośnie do czterech, a podsumowanie rozbija kwotę', async () => {
      const ctx = await setup('?serviceId=s2', true);
      await flushSlots(ctx, await pickAnyEmployeeAndDate(ctx), [
        { employeeId: 'e3', startsAt: SLOT_C },
      ]);

      expect(ctx.text()).toContain('Krok 3 z 4');

      slotButtons(ctx.el())[0].click();
      await settle(ctx.harness.fixture);
      ctx.harness.detectChanges();

      expect(ctx.text()).toContain('Zaliczka (online)');
      expect(ctx.text()).toContain('60 zł');
      expect(ctx.text()).toContain('Do zapłaty na miejscu');
      expect(ctx.text()).toContain('140 zł');
      expect(ctx.text()).toContain('Zarezerwuj i zapłać zaliczkę');
    });

    it('usługa bez zaliczki zostaje przy trzech krokach', async () => {
      const { text } = await setup('?serviceId=s1');

      expect(text()).toContain('Krok 2 z 3');
    });

    it('client_secret z odpowiedzi trafia do kroku płatności, bez wychodzenia z kreatora', async () => {
      const ctx = await setup('?serviceId=s2', true);
      (await bookWithDeposit(ctx)).flush(paymentBody);
      await settle(ctx.harness.fixture);
      ctx.harness.detectChanges();

      expect(ctx.text()).toContain('Termin zarezerwowany');
      expect(ctx.text()).toContain('Czeka na opłacenie zaliczki');
      expect(ctx.text()).toContain('4. Zapłać zaliczkę');
      expect(ctx.stripe.stripe.elements).toHaveBeenCalledWith(
        expect.objectContaining({ clientSecret: 'pi_2_secret_x' }),
      );
      // dopóki zaliczka nie jest opłacona, nie zapraszamy do wyjścia z kreatora
      expect(ctx.text()).not.toContain('Wróć do profilu firmy');
    });

    it('opłacenie zaliczki zamienia krok płatności w potwierdzenie', async () => {
      const ctx = await setup('?serviceId=s2', true);
      (await bookWithDeposit(ctx)).flush(paymentBody);
      await settle(ctx.harness.fixture);
      ctx.harness.detectChanges();

      must<HTMLButtonElement>(
        ctx.el(),
        'app-deposit-payment .btn-primary',
      ).click();
      await settle(ctx.harness.fixture);
      ctx.harness.detectChanges();

      expect(ctx.text()).toContain('Rezerwacja przyjęta');
      expect(ctx.text()).toContain('60 zł — opłacona');
      expect(ctx.text()).toContain('Moje wizyty');
      expect(ctx.el().querySelector('app-deposit-payment')).toBeNull();
    });

    // powrót z BLIK-a/Przelewów24: rezerwacji nie ma już w pamięci kreatora, więc stan
    // płatności czytamy ze Stripe'a, a nie z parametru `redirect_status` w adresie
    it('powrót z przekierowania pokazuje wynik płatności zamiast pustego kroku 3', async () => {
      const ctx = await setup(
        '?serviceId=s2&payment_intent_client_secret=pi_2_secret_x',
        true,
      );
      await settle(ctx.harness.fixture);
      ctx.harness.detectChanges();

      expect(ctx.stripe.retrievePaymentIntent).toHaveBeenCalledWith(
        'pi_2_secret_x',
      );
      expect(ctx.text()).toContain('Zaliczka opłacona');
    });

    it('powrót z nieudanej płatności tłumaczy, co dalej', async () => {
      const stripe = fakeStripe();
      stripe.retrievePaymentIntent.mockResolvedValue({
        paymentIntent: { status: 'requires_payment_method' },
      });
      const ctx = await setup(
        '?serviceId=s2&payment_intent_client_secret=pi_2_secret_x',
        true,
        stripe,
      );
      await settle(ctx.harness.fixture);
      ctx.harness.detectChanges();

      expect(ctx.text()).toContain('Płatność niedokończona');
      const alert = ctx.el().querySelector('[role="alert"]')?.textContent ?? '';
      expect(alert).toContain('Nie otrzymaliśmy zaliczki');
      expect(alert).toContain('Zarezerwuj go jeszcze raz');
      // ponowienie żyje tylko w kreatorze — „Moje wizyty" nie mają czym zapłacić,
      // więc komunikat nie może tam odsyłać po płatność
      expect(alert).not.toContain('opłacić');
    });

    // nieodczytany status ≠ brak płatności: klient, który właśnie zapłacił BLIK-iem,
    // nie może dostać komunikatu wypychającego go w drugą płatność
    it('gdy nie da się odpytać Stripe’a, kreator nie twierdzi, że zaliczki nie było', async () => {
      const stripe = fakeStripe();
      stripe.retrievePaymentIntent.mockResolvedValue({
        error: { message: 'network error' },
      });
      const ctx = await setup(
        '?serviceId=s2&payment_intent_client_secret=pi_2_secret_x',
        true,
        stripe,
      );
      await settle(ctx.harness.fixture);
      ctx.harness.detectChanges();

      const alert = ctx.el().querySelector('[role="alert"]')?.textContent ?? '';
      expect(ctx.text()).toContain('Nie znamy statusu płatności');
      expect(alert).toContain('Nie płać drugi raz');
      expect(alert).not.toContain('Nie otrzymaliśmy zaliczki');
    });

    it('niedostępny Stripe po powrocie też daje „nie wiemy", nie „nie zapłacono"', async () => {
      const ctx = await setup(
        '?serviceId=s2&payment_intent_client_secret=pi_2_secret_x',
        true,
        { stripe: null } as unknown as ReturnType<typeof fakeStripe>,
      );
      await settle(ctx.harness.fixture);
      ctx.harness.detectChanges();

      expect(ctx.text()).toContain('Nie znamy statusu płatności');
    });

    it('gdy formularz płatności nie wstaje, klient dostaje wyjście z ekranu', async () => {
      const ctx = await setup('?serviceId=s2', true, {
        stripe: null,
      } as unknown as ReturnType<typeof fakeStripe>);
      (await bookWithDeposit(ctx)).flush(paymentBody);
      await settle(ctx.harness.fixture);
      ctx.harness.detectChanges();

      expect(ctx.text()).toContain('Nie udało się załadować formularza płatności');
      // bez „odśwież stronę": przeładowanie gubi client_secret bezpowrotnie
      expect(ctx.text()).not.toContain('Odśwież stronę');
      expect(ctx.text()).toContain('Wróć do profilu firmy');
    });
  });

  it('404: pokazuje stronę „nie znaleziono"', async () => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            path: ':slug',
            children: [{ path: 'rezerwacja', component: BookingWizard }],
          },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/brak/rezerwacja', BookingWizard);
    const http = TestBed.inject(HttpTestingController);
    http
      .expectOne('/api/businesses/brak')
      .flush('Nie znaleziono firmy', { status: 404, statusText: 'Not Found' });
    await settle(harness.fixture);
    harness.detectChanges();

    expect((harness.fixture.nativeElement as HTMLElement).textContent).toContain(
      'Nie znaleziono strony',
    );
  });
});
