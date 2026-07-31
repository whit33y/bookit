import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  Router,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { of } from 'rxjs';
import { setValue } from '../public/testing-helpers';
import AdminBusinesses, { AdminBusiness } from './admin-businesses';

// jsdom nie implementuje showModal()/close() — ten sam lokalny polyfill co w
// business/calendar/booking-details-dialog.spec.ts
beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

const business = (over: Partial<AdminBusiness> = {}): AdminBusiness => ({
  id: 'b1',
  slug: 'studio-nozyczki',
  name: 'Studio Nożyczki',
  city: 'Kraków',
  street: 'Józefa 12',
  isBlocked: false,
  createdAt: '2026-03-01T10:00:00Z',
  updatedAt: '2026-03-01T10:00:00Z',
  category: { id: 'c1', name: 'Fryzjer', slug: 'fryzjer' },
  owner: {
    id: 'u1',
    email: 'anna@nozyczki.pl',
    firstName: 'Anna',
    lastName: 'Kowalska',
  },
  _count: { services: 3, employees: 2, bookings: 41 },
  ...over,
});

const response = (items: AdminBusiness[], total = items.length) => ({
  items,
  total,
  page: 1,
  limit: 20,
});

async function setup(params: Record<string, string> = {}) {
  await TestBed.configureTestingModule({
    imports: [AdminBusinesses],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: ActivatedRoute,
        useValue: { queryParamMap: of(convertToParamMap(params)) },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(AdminBusinesses);
  const http = TestBed.inject(HttpTestingController);
  // spy zamiast prawdziwej nawigacji — ActivatedRoute jest atrapą, więc relativeTo
  // nie miałoby czego rozwiązać; interesuje nas sama intencja komponentu
  const navigate = vi
    .spyOn(TestBed.inject(Router), 'navigate')
    .mockResolvedValue(true);
  return { fixture, http, navigate };
}

const html = (fixture: ComponentFixture<AdminBusinesses>) =>
  fixture.nativeElement as HTMLElement;

const textOf = (fixture: ComponentFixture<AdminBusinesses>) =>
  (html(fixture).textContent ?? '').replace(/\s+/g, ' ').trim();

function clickButton(
  fixture: ComponentFixture<AdminBusinesses>,
  label: string,
): void {
  const button = Array.from(html(fixture).querySelectorAll('button')).find(
    (b) => (b.textContent ?? '').trim() === label,
  );
  if (!button) {
    throw new Error(`Nie znaleziono przycisku „${label}"`);
  }
  button.click();
}

const isDialogOpen = (fixture: ComponentFixture<AdminBusinesses>) =>
  html(fixture).querySelector('dialog')?.hasAttribute('open') ?? false;

describe('AdminBusinesses', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('woła /admin/businesses z filtrami z URL i renderuje wiersze', async () => {
    const { fixture, http } = await setup({ q: 'studio', blocked: 'false', page: '2' });
    const req = http.expectOne(
      '/api/admin/businesses?q=studio&blocked=false&page=2',
    );
    expect(req.request.method).toBe('GET');
    req.flush(response([business()]));
    await fixture.whenStable();

    const text = textOf(fixture);
    expect(text).toContain('Studio Nożyczki');
    expect(text).toContain('Fryzjer · Kraków, Józefa 12');
    expect(text).toContain('anna@nozyczki.pl');
    expect(text).toContain('Aktywna');
  });

  it('pusta fraza w URL nie trafia do zapytania (backend odrzuciłby q=)', async () => {
    const { fixture, http } = await setup({ q: '  ' });
    http.expectOne('/api/admin/businesses').flush(response([business()]));
    await fixture.whenStable();
  });

  it('blokada wymaga potwierdzenia i dopiero wtedy woła API', async () => {
    const { fixture, http } = await setup();
    http.expectOne('/api/admin/businesses').flush(response([business()]));
    await fixture.whenStable();

    clickButton(fixture, 'Zablokuj');
    await fixture.whenStable();

    expect(isDialogOpen(fixture)).toBe(true);
    expect(textOf(fixture)).toContain('Zablokować firmę?');
    // przed potwierdzeniem nic nie leci na serwer — to jest sedno „blokady z potwierdzeniem"
    http.verify();

    clickButton(fixture, 'Zablokuj firmę');
    const req = http.expectOne('/api/admin/businesses/b1/block');
    expect(req.request.method).toBe('POST');
    req.flush(business({ isBlocked: true }));
    await fixture.whenStable();

    expect(textOf(fixture)).toContain('Zablokowana');
    expect(isDialogOpen(fixture)).toBe(false);
  });

  it('po blokadzie wiersz zmienia status bez ponownego pobrania listy', async () => {
    const { fixture, http } = await setup();
    http
      .expectOne('/api/admin/businesses')
      .flush(response([business(), business({ id: 'b2', name: 'Salon Ewa' })]));
    await fixture.whenStable();

    clickButton(fixture, 'Zablokuj');
    await fixture.whenStable();
    clickButton(fixture, 'Zablokuj firmę');
    http
      .expectOne('/api/admin/businesses/b1/block')
      .flush(business({ isBlocked: true }));
    await fixture.whenStable();

    // brak drugiego GET-a: verify() w afterEach wyłapałby niezużyte żądanie
    const rows = html(fixture).querySelectorAll('tbody tr');
    expect(rows[0].textContent).toContain('Zablokowana');
    expect(rows[1].textContent).toContain('Aktywna');
    // zmiana ogłoszona czytnikowi ekranu
    expect(html(fixture).querySelector('[role="status"]')?.textContent).toContain(
      'została zablokowana',
    );
  });

  it('zablokowana firma dostaje akcję odblokowania', async () => {
    const { fixture, http } = await setup();
    http
      .expectOne('/api/admin/businesses')
      .flush(response([business({ isBlocked: true })]));
    await fixture.whenStable();

    clickButton(fixture, 'Odblokuj');
    await fixture.whenStable();
    expect(textOf(fixture)).toContain('Odblokować firmę?');

    clickButton(fixture, 'Odblokuj firmę');
    http
      .expectOne('/api/admin/businesses/b1/unblock')
      .flush(business({ isBlocked: false }));
    await fixture.whenStable();

    expect(textOf(fixture)).toContain('Aktywna');
  });

  it('rezygnacja w modalu nie wysyła żadnego żądania', async () => {
    const { fixture, http } = await setup();
    http.expectOne('/api/admin/businesses').flush(response([business()]));
    await fixture.whenStable();

    clickButton(fixture, 'Zablokuj');
    await fixture.whenStable();
    clickButton(fixture, 'Wróć');
    await fixture.whenStable();

    expect(isDialogOpen(fixture)).toBe(false);
    expect(textOf(fixture)).toContain('Aktywna');
  });

  it('404 przy blokadzie pokazuje komunikat w wierszu i nie zmienia statusu', async () => {
    const { fixture, http } = await setup();
    http.expectOne('/api/admin/businesses').flush(response([business()]));
    await fixture.whenStable();

    clickButton(fixture, 'Zablokuj');
    await fixture.whenStable();
    clickButton(fixture, 'Zablokuj firmę');
    http
      .expectOne('/api/admin/businesses/b1/block')
      .flush(
        { statusCode: 404, code: 'NOT_FOUND', message: 'Nie znaleziono firmy' },
        { status: 404, statusText: 'Not Found' },
      );
    await fixture.whenStable();

    const row = html(fixture).querySelector('tbody tr');
    expect(row?.textContent).toContain('Nie znaleziono firmy');
    expect(row?.textContent).toContain('Aktywna');
    expect(isDialogOpen(fixture)).toBe(false);
  });

  it('odblokowana firma znika z listy filtrowanej po zablokowanych i koryguje licznik', async () => {
    const { fixture, http } = await setup({ blocked: 'true' });
    http
      .expectOne('/api/admin/businesses?blocked=true')
      .flush(
        response(
          [
            business({ isBlocked: true }),
            business({ id: 'b2', name: 'Salon Ewa', isBlocked: true }),
          ],
          40,
        ),
      );
    await fixture.whenStable();

    clickButton(fixture, 'Odblokuj');
    await fixture.whenStable();
    clickButton(fixture, 'Odblokuj firmę');
    http
      .expectOne('/api/admin/businesses/b1/unblock')
      .flush(business({ isBlocked: false }));
    await fixture.whenStable();

    const rows = html(fixture).querySelectorAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('Salon Ewa');
    expect(textOf(fixture)).toContain('z 39 firm');
  });

  it('pusta strona poza zakresem daje powrót na pierwszą stronę', async () => {
    const { fixture, http, navigate } = await setup({ page: '3' });
    http.expectOne('/api/admin/businesses?page=3').flush(response([]));
    await fixture.whenStable();

    const text = textOf(fixture);
    expect(text).toContain('Ta strona nie ma już wyników.');
    expect(text).not.toContain('Nie ma jeszcze żadnych firm.');

    clickButton(fixture, 'Wróć na pierwszą stronę');
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { page: null } }),
    );
  });

  it('błąd listy pokazuje alert zamiast tabeli', async () => {
    const { fixture, http } = await setup();
    http
      .expectOne('/api/admin/businesses')
      .flush('Błąd', { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();

    expect(html(fixture).querySelector('table')).toBeNull();
    expect(html(fixture).querySelector('[role="alert"]')?.textContent).toContain(
      'Wystąpił nieoczekiwany błąd serwera',
    );
  });

  it('pusty wynik z filtrem tłumaczy, że to filtry, a nie pusta baza', async () => {
    const { fixture, http } = await setup({ q: 'nieistnieje' });
    http.expectOne('/api/admin/businesses?q=nieistnieje').flush(response([]));
    await fixture.whenStable();

    expect(textOf(fixture)).toContain('Brak firm dla podanych filtrów.');
  });

  it('pusta lista bez filtrów mówi wprost, że firm jeszcze nie ma', async () => {
    const { fixture, http } = await setup();
    http.expectOne('/api/admin/businesses').flush(response([]));
    await fixture.whenStable();

    expect(textOf(fixture)).toContain('Nie ma jeszcze żadnych firm.');
  });

  it('zmiana strony zapisuje się do URL', async () => {
    const { fixture, http, navigate } = await setup();
    http.expectOne('/api/admin/businesses').flush(response([business()], 47));
    await fixture.whenStable();

    clickButton(fixture, 'Następna ›');

    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: { page: 2 },
        queryParamsHandling: 'merge',
      }),
    );
  });

  it('wyszukiwanie zapisuje frazę do URL i wraca na pierwszą stronę', async () => {
    const { fixture, http, navigate } = await setup({ page: '4' });
    http.expectOne('/api/admin/businesses?page=4').flush(response([business()]));
    await fixture.whenStable();

    const input = html(fixture).querySelector('#admin-search') as HTMLInputElement;
    setValue(input, '  salon  ');
    const form = html(fixture).querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: { q: 'salon', blocked: null, page: null },
        queryParamsHandling: 'merge',
      }),
    );
  });

  it('filtr statusu zapisuje się do URL', async () => {
    const { fixture, http, navigate } = await setup();
    http.expectOne('/api/admin/businesses').flush(response([business()]));
    await fixture.whenStable();

    const select = html(fixture).querySelector('#admin-status') as HTMLSelectElement;
    select.value = 'true';
    select.dispatchEvent(new Event('change'));
    (html(fixture).querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { cancelable: true }),
    );

    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: { q: null, blocked: 'true', page: null },
        queryParamsHandling: 'merge',
      }),
    );
  });
});
