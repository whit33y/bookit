import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
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
      employees: [
        { id: 'e1', name: 'Anna Kowalska' },
        { id: 'e2', name: 'Bartosz Nowak' },
      ],
    },
    {
      id: 's2',
      name: 'Koloryzacja',
      description: null,
      durationMin: 90,
      priceCents: 20000,
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

async function setup(query = '?serviceId=s1', loggedIn = false) {
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
    ],
  });

  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl('/test-slug/rezerwacja' + query, BookingWizard);
  const http = TestBed.inject(HttpTestingController);
  http.expectOne('/api/businesses/test-slug').flush(MOCK);
  await settle(harness.fixture);
  harness.detectChanges();

  const el = () => harness.fixture.nativeElement as HTMLElement;
  const text = () => el().textContent ?? '';
  const availability = () =>
    http.expectOne((r) =>
      r.url.startsWith('/api/businesses/test-slug/availability'),
    );

  return { harness, http, el, text, availability };
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
      { message: 'Wybrany termin jest już zajęty' },
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
        { message: 'Wybrany termin jest już zajęty' },
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
