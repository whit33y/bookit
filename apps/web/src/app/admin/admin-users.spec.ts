import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { of } from 'rxjs';
import AdminUsers, { AdminUser } from './admin-users';

const user = (over: Partial<AdminUser> = {}): AdminUser => ({
  id: 'u1',
  email: 'anna@nozyczki.pl',
  firstName: 'Anna',
  lastName: 'Kowalska',
  phone: '600100200',
  role: 'OWNER',
  isBlocked: false,
  createdAt: '2026-03-01T10:00:00Z',
  business: {
    id: 'b1',
    slug: 'studio-nozyczki',
    name: 'Studio Nożyczki',
    isBlocked: false,
  },
  ...over,
});

const response = (items: AdminUser[], total = items.length) => ({
  items,
  total,
  page: 1,
  limit: 20,
});

async function setup(params: Record<string, string> = {}) {
  await TestBed.configureTestingModule({
    imports: [AdminUsers],
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

  const fixture = TestBed.createComponent(AdminUsers);
  const http = TestBed.inject(HttpTestingController);
  return { fixture, http };
}

const html = (fixture: ComponentFixture<AdminUsers>) =>
  fixture.nativeElement as HTMLElement;

const textOf = (fixture: ComponentFixture<AdminUsers>) =>
  (html(fixture).textContent ?? '').replace(/\s+/g, ' ').trim();

describe('AdminUsers', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('woła /admin/users z filtrami z URL i renderuje dane użytkownika', async () => {
    const { fixture, http } = await setup({ q: 'anna', blocked: 'true' });
    http
      .expectOne('/api/admin/users?q=anna&blocked=true')
      .flush(response([user()]));
    await fixture.whenStable();

    const text = textOf(fixture);
    expect(text).toContain('Anna Kowalska');
    expect(text).toContain('anna@nozyczki.pl');
    expect(text).toContain('600100200');
    expect(text).toContain('Studio Nożyczki');
  });

  it('tłumaczy role na polskie etykiety', async () => {
    const { fixture, http } = await setup();
    http.expectOne('/api/admin/users').flush(
      response([
        user({ id: 'u1', role: 'CLIENT' }),
        user({ id: 'u2', role: 'OWNER' }),
        user({ id: 'u3', role: 'EMPLOYEE' }),
        user({ id: 'u4', role: 'ADMIN' }),
      ]),
    );
    await fixture.whenStable();

    const roles = Array.from(html(fixture).querySelectorAll('tbody tr')).map(
      (row) => row.querySelectorAll('td')[2].textContent?.trim(),
    );
    expect(roles).toEqual(['Klient', 'Właściciel', 'Pracownik', 'Administrator']);
  });

  it('pokazuje status blokady konta, ale nie oferuje akcji — API jej nie ma', async () => {
    const { fixture, http } = await setup();
    http
      .expectOne('/api/admin/users')
      .flush(response([user({ isBlocked: true })]));
    await fixture.whenStable();

    expect(textOf(fixture)).toContain('Zablokowany');
    const rowButtons = html(fixture).querySelectorAll('tbody button');
    expect(rowButtons).toHaveLength(0);
  });

  it('brak telefonu i firmy pokazuje półpauzę zamiast pustej komórki', async () => {
    const { fixture, http } = await setup();
    http
      .expectOne('/api/admin/users')
      .flush(response([user({ phone: null, business: null, role: 'CLIENT' })]));
    await fixture.whenStable();

    const cells = Array.from(
      html(fixture).querySelectorAll('tbody tr td'),
    ).map((td) => td.textContent?.trim());
    expect(cells[1]).toBe('—');
    expect(cells[3]).toBe('—');
  });

  it('oznacza zablokowaną firmę przy właścicielu', async () => {
    const { fixture, http } = await setup();
    http.expectOne('/api/admin/users').flush(
      response([
        user({
          business: {
            id: 'b1',
            slug: 'studio-nozyczki',
            name: 'Studio Nożyczki',
            isBlocked: true,
          },
        }),
      ]),
    );
    await fixture.whenStable();

    const businessCell = html(fixture).querySelectorAll('tbody tr td')[3];
    expect(businessCell.textContent).toContain('zablokowana');
  });

  it('błąd serwera pokazuje alert zamiast tabeli', async () => {
    const { fixture, http } = await setup();
    http
      .expectOne('/api/admin/users')
      .flush('Błąd', { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();

    expect(html(fixture).querySelector('table')).toBeNull();
    expect(html(fixture).querySelector('[role="alert"]')?.textContent).toContain(
      'Wystąpił nieoczekiwany błąd serwera',
    );
  });

  it('retry po błędzie powtarza zapytanie z aktualnymi filtrami', async () => {
    // filtr siedzi w URL, a nawigacja na te same query params nie wywołałaby load() —
    // dlatego retry idzie przez reload(), nie przez router
    const { fixture, http } = await setup({ q: 'kowal' });
    http
      .expectOne((r) => r.url.startsWith('/api/admin/users'))
      .flush('Błąd', { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();

    const retry = [
      ...html(fixture).querySelectorAll<HTMLButtonElement>('button'),
    ].find((b) => b.textContent?.includes('Spróbuj ponownie'));
    retry?.click();
    await fixture.whenStable();

    const retried = http.expectOne((r) => r.url.startsWith('/api/admin/users'));
    expect(retried.request.url).toContain('q=kowal');
    retried.flush({ items: [], total: 0, page: 1, limit: 20 });
    await fixture.whenStable();

    expect(html(fixture).querySelector('[role="alert"]')).toBeNull();
  });

  it('prowadzi do formularza nowego administratora', async () => {
    const { fixture, http } = await setup();
    http
      .expectOne((r) => r.url.startsWith('/api/admin/users'))
      .flush(response([user()]));
    fixture.detectChanges();

    const link = html(fixture).querySelector<HTMLAnchorElement>(
      'a[href="/admin/users/new"]',
    );
    expect(link?.textContent).toContain('Dodaj administratora');
  });
});
