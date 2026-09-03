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
import { settle, setValue } from '../public/testing-helpers';
import AdminBusinessApplications, {
  AdminApplication,
} from './admin-business-applications';

// jsdom nie implementuje showModal()/close() — ten sam lokalny polyfill co w
// admin-businesses.spec.ts
beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

const application = (over: Partial<AdminApplication> = {}): AdminApplication => ({
  id: 'a1',
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
  _count: { services: 0, employees: 0, bookings: 0 },
  status: 'PENDING',
  rejectionReason: null,
  ...over,
});

const response = (items: AdminApplication[], total = items.length) => ({
  items,
  total,
  page: 1,
  limit: 20,
});

async function setup(params: Record<string, string> = {}) {
  await TestBed.configureTestingModule({
    imports: [AdminBusinessApplications],
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

  const fixture = TestBed.createComponent(AdminBusinessApplications);
  const http = TestBed.inject(HttpTestingController);
  // spy zamiast prawdziwej nawigacji — ActivatedRoute jest atrapą, więc relativeTo
  // nie miałoby czego rozwiązać; interesuje nas sama intencja komponentu
  const navigate = vi
    .spyOn(TestBed.inject(Router), 'navigate')
    .mockResolvedValue(true);
  return { fixture, http, navigate };
}

type Fixture = ComponentFixture<AdminBusinessApplications>;

const html = (fixture: Fixture) => fixture.nativeElement as HTMLElement;

const textOf = (fixture: Fixture) =>
  (html(fixture).textContent ?? '').replace(/\s+/g, ' ').trim();

/** Klika przycisk po widocznej etykiecie. Szuka w otwartym modalu, gdy jakiś jest otwarty:
 *  „Wróć" ma i modal akceptacji, i modal odrzucenia — oba są w DOM-ie cały czas, więc szukanie
 *  po całym drzewie trafiałoby zawsze w ten pierwszy. */
function clickButton(fixture: Fixture, label: string): void {
  const scope: ParentNode = openDialogs(fixture)[0] ?? html(fixture);
  const button = Array.from(scope.querySelectorAll('button')).find(
    (b) => (b.textContent ?? '').trim() === label,
  );
  if (!button) {
    throw new Error(`Nie znaleziono przycisku „${label}"`);
  }
  button.click();
}

function reasonField(fixture: Fixture): HTMLTextAreaElement {
  const field = html(fixture).querySelector<HTMLTextAreaElement>(
    '#reject-application-reason',
  );
  if (!field) {
    throw new Error('Modal odrzucenia nie ma pola powodu');
  }
  return field;
}

const openDialogs = (fixture: Fixture) =>
  Array.from(html(fixture).querySelectorAll('dialog')).filter((d) =>
    d.hasAttribute('open'),
  );

/** Wysyła formularz odrzucenia tak, jak zrobiłby to Enter w polu albo klik w „Odrzuć
 *  zgłoszenie" — przez submit formularza, nie przez wywołanie metody komponentu. */
async function submitReject(fixture: Fixture): Promise<void> {
  const form = openDialogs(fixture)[0]?.querySelector('form');
  form?.dispatchEvent(new Event('submit', { cancelable: true }));
  await settle(fixture);
}

describe('AdminBusinessApplications', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('woła /admin/business-applications i renderuje wiersze kolejki', async () => {
    const { fixture, http } = await setup();
    const req = http.expectOne('/api/admin/business-applications');
    expect(req.request.method).toBe('GET');
    req.flush(response([application()]));
    await settle(fixture);

    const text = textOf(fixture);
    expect(text).toContain('Studio Nożyczki');
    expect(text).toContain('Fryzjer · Kraków, Józefa 12');
    expect(text).toContain('Anna Kowalska');
    expect(text).toContain('anna@nozyczki.pl');
    expect(text).toContain('1.03.2026');
  });

  it('przenosi stronę z URL-a do zapytania, a filtry rejestru firm ignoruje', async () => {
    // AdminApplicationsQueryDto nie zna `blocked` ani (na tym ekranie) frazy — przepisany
    // z rejestru firm URL nie może zamienić listy w błąd 400
    const { fixture, http } = await setup({ page: '2', blocked: 'true', q: 'studio' });
    http
      .expectOne('/api/admin/business-applications?page=2')
      .flush(response([application()], 40));
    await settle(fixture);
  });

  it('akceptacja wymaga potwierdzenia, a po nim wiersz znika z kolejki', async () => {
    const { fixture, http } = await setup();
    http
      .expectOne('/api/admin/business-applications')
      .flush(
        response([application(), application({ id: 'a2', name: 'Salon Ewa' })], 40),
      );
    await settle(fixture);

    clickButton(fixture, 'Akceptuj');
    await settle(fixture);

    expect(textOf(fixture)).toContain('Zaakceptować zgłoszenie?');
    // przed potwierdzeniem nic nie leci na serwer
    http.verify();

    clickButton(fixture, 'Akceptuj zgłoszenie');
    const req = http.expectOne('/api/admin/business-applications/a1/approve');
    expect(req.request.method).toBe('POST');
    req.flush(application({ status: 'APPROVED' }));
    await settle(fixture);

    // brak drugiego GET-a: verify() w afterEach wyłapałby niezużyte żądanie
    const rows = html(fixture).querySelectorAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('Salon Ewa');
    expect(html(fixture).querySelector('[role="status"]')?.textContent).toContain(
      'zostało zaakceptowane',
    );
    expect(openDialogs(fixture)).toHaveLength(0);
    // licznik w stopce zjeżdża o rozpatrzone zgłoszenie, bez ponownego GET-a
    expect(textOf(fixture)).toContain('z 39 zgłoszeń');
  });

  it('odrzucenie bez powodu nie wysyła żądania i pokazuje błąd pola', async () => {
    const { fixture, http } = await setup();
    http.expectOne('/api/admin/business-applications').flush(response([application()]));
    await settle(fixture);

    clickButton(fixture, 'Odrzuć');
    await settle(fixture);
    await submitReject(fixture);

    // to jest sedno AC: bez powodu nie da się wysłać
    http.verify();
    expect(textOf(fixture)).toContain('Podaj powód odrzucenia');
    expect(openDialogs(fixture)).toHaveLength(1);
    expect(reasonField(fixture).getAttribute('aria-invalid')).toBe('true');
  });

  it('sam biały znak też nie jest powodem', async () => {
    const { fixture, http } = await setup();
    http.expectOne('/api/admin/business-applications').flush(response([application()]));
    await settle(fixture);

    clickButton(fixture, 'Odrzuć');
    await settle(fixture);
    setValue(reasonField(fixture), '   ');
    await settle(fixture);
    await submitReject(fixture);

    http.verify();
    expect(textOf(fixture)).toContain('Podaj powód odrzucenia');
  });

  it('powód dłuższy niż 500 znaków jest odrzucany po naszej stronie', async () => {
    const { fixture, http } = await setup();
    http.expectOne('/api/admin/business-applications').flush(response([application()]));
    await settle(fixture);

    clickButton(fixture, 'Odrzuć');
    await settle(fixture);
    setValue(reasonField(fixture), 'x'.repeat(501));
    await settle(fixture);
    await submitReject(fixture);

    http.verify();
    expect(textOf(fixture)).toContain('Powód może mieć maksymalnie 500 znaków');
  });

  it('odrzucenie z powodem wysyła przycięty powód i usuwa wiersz', async () => {
    const { fixture, http } = await setup();
    http.expectOne('/api/admin/business-applications').flush(response([application()]));
    await settle(fixture);

    clickButton(fixture, 'Odrzuć');
    await settle(fixture);
    expect(textOf(fixture)).toContain('Studio Nożyczki');

    setValue(reasonField(fixture), '  Adres nie zgadza się z nazwą.  ');
    await settle(fixture);
    await submitReject(fixture);

    const req = http.expectOne('/api/admin/business-applications/a1/reject');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ reason: 'Adres nie zgadza się z nazwą.' });
    req.flush(
      application({ status: 'REJECTED', rejectionReason: 'Adres nie zgadza się z nazwą.' }),
    );
    await settle(fixture);

    expect(html(fixture).querySelectorAll('tbody tr')).toHaveLength(0);
    expect(textOf(fixture)).toContain('Brak zgłoszeń czekających na decyzję.');
    expect(html(fixture).querySelector('[role="status"]')?.textContent).toContain(
      'zostało odrzucone',
    );
    expect(openDialogs(fixture)).toHaveLength(0);
  });

  it('awaria sieci przy odrzuceniu zostawia modal z wpisanym powodem i pokazuje błąd', async () => {
    const { fixture, http } = await setup();
    http.expectOne('/api/admin/business-applications').flush(response([application()]));
    await settle(fixture);

    clickButton(fixture, 'Odrzuć');
    await settle(fixture);
    setValue(reasonField(fixture), 'Brak zgody na regulamin.');
    await settle(fixture);
    await submitReject(fixture);

    http
      .expectOne('/api/admin/business-applications/a1/reject')
      .flush('Błąd', { status: 500, statusText: 'Server Error' });
    await settle(fixture);

    expect(openDialogs(fixture)).toHaveLength(1);
    expect(reasonField(fixture).value).toBe('Brak zgody na regulamin.');
    expect(
      html(fixture).querySelector('dialog[open] [role="alert"]')?.textContent,
    ).toContain('Wystąpił nieoczekiwany błąd serwera');
    // wiersz zostaje w kolejce: żądanie da się ponowić, decyzja jeszcze nie zapadła
    expect(html(fixture).querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('409 znaczy „ktoś już zdecydował" — wiersz wypada z kolejki z wyjaśnieniem', async () => {
    const { fixture, http } = await setup();
    http
      .expectOne('/api/admin/business-applications')
      .flush(response([application(), application({ id: 'a2', name: 'Salon Ewa' })]));
    await settle(fixture);

    clickButton(fixture, 'Odrzuć');
    await settle(fixture);
    setValue(reasonField(fixture), 'Brak zgody na regulamin.');
    await settle(fixture);
    await submitReject(fixture);

    http
      .expectOne('/api/admin/business-applications/a1/reject')
      .flush(
        {
          statusCode: 409,
          code: 'CONFLICT',
          message: 'Zgłoszenie zostało już rozpatrzone',
        },
        { status: 409, statusText: 'Conflict' },
      );
    await settle(fixture);

    // ponowienie wracałoby tym samym 409 — w kolejce nie ma już czego rozpatrywać
    const rows = html(fixture).querySelectorAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('Salon Ewa');
    expect(openDialogs(fixture)).toHaveLength(0);
    expect(html(fixture).querySelector('[role="alert"]')?.textContent).toContain(
      'zostało już rozpatrzone i zniknęło z kolejki',
    );
  });

  it('404 przy akceptacji także zdejmuje zgłoszenie z kolejki', async () => {
    const { fixture, http } = await setup();
    http
      .expectOne('/api/admin/business-applications')
      .flush(response([application()]));
    await settle(fixture);

    clickButton(fixture, 'Akceptuj');
    await settle(fixture);
    clickButton(fixture, 'Akceptuj zgłoszenie');
    http
      .expectOne('/api/admin/business-applications/a1/approve')
      .flush(
        { statusCode: 404, code: 'NOT_FOUND', message: 'Nie znaleziono zgłoszenia' },
        { status: 404, statusText: 'Not Found' },
      );
    await settle(fixture);

    expect(html(fixture).querySelectorAll('tbody tr')).toHaveLength(0);
    expect(textOf(fixture)).toContain('zostało już rozpatrzone i zniknęło z kolejki');
  });

  it('awaria serwera przy akceptacji zamyka modal i pokazuje błąd w wierszu', async () => {
    const { fixture, http } = await setup();
    http.expectOne('/api/admin/business-applications').flush(response([application()]));
    await settle(fixture);

    clickButton(fixture, 'Akceptuj');
    await settle(fixture);
    clickButton(fixture, 'Akceptuj zgłoszenie');
    http
      .expectOne('/api/admin/business-applications/a1/approve')
      .flush('Błąd', { status: 500, statusText: 'Server Error' });
    await settle(fixture);

    const row = html(fixture).querySelector('tbody tr');
    expect(row?.textContent).toContain('Wystąpił nieoczekiwany błąd serwera');
    expect(openDialogs(fixture)).toHaveLength(0);
  });

  it('rezygnacja w modalu odrzucenia nie wysyła żądania', async () => {
    const { fixture, http } = await setup();
    http.expectOne('/api/admin/business-applications').flush(response([application()]));
    await settle(fixture);

    clickButton(fixture, 'Odrzuć');
    await settle(fixture);
    clickButton(fixture, 'Wróć');
    await settle(fixture);

    expect(openDialogs(fixture)).toHaveLength(0);
    expect(html(fixture).querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('pusta kolejka mówi wprost, że nie ma czego rozpatrywać', async () => {
    const { fixture, http } = await setup();
    http.expectOne('/api/admin/business-applications').flush(response([]));
    await settle(fixture);

    expect(html(fixture).querySelector('table')).toBeNull();
    expect(textOf(fixture)).toContain('Brak zgłoszeń czekających na decyzję.');
  });

  it('pusta strona poza zakresem daje powrót na pierwszą stronę', async () => {
    const { fixture, http, navigate } = await setup({ page: '3' });
    http
      .expectOne('/api/admin/business-applications?page=3')
      .flush(response([], 0));
    await settle(fixture);

    const text = textOf(fixture);
    expect(text).toContain('Ta strona nie ma już wyników.');
    expect(text).not.toContain('Brak zgłoszeń czekających na decyzję.');

    clickButton(fixture, 'Wróć na pierwszą stronę');
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { page: null } }),
    );
  });

  it('w trakcie pobierania pokazuje stan ładowania zamiast tabeli', async () => {
    const { fixture, http } = await setup();
    const req = http.expectOne('/api/admin/business-applications');
    await settle(fixture);

    expect(html(fixture).querySelector('table')).toBeNull();
    expect(textOf(fixture)).toContain('Ładowanie…');

    req.flush(response([application()]));
    await settle(fixture);
    expect(html(fixture).querySelector('table')).not.toBeNull();
  });

  it('błąd listy pokazuje alert z ponowieniem, które powtarza zapytanie', async () => {
    const { fixture, http } = await setup();
    http
      .expectOne('/api/admin/business-applications')
      .flush('Błąd', { status: 500, statusText: 'Server Error' });
    await settle(fixture);

    expect(html(fixture).querySelector('table')).toBeNull();
    expect(html(fixture).querySelector('[role="alert"]')?.textContent).toContain(
      'Wystąpił nieoczekiwany błąd serwera',
    );

    clickButton(fixture, 'Spróbuj ponownie');
    http.expectOne('/api/admin/business-applications').flush(response([application()]));
    await settle(fixture);

    expect(textOf(fixture)).toContain('Studio Nożyczki');
  });
});
