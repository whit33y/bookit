import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import BusinessStats from './stats';

const STATUSES = [
  'PENDING',
  'CONFIRMED',
  'DECLINED',
  'CANCELLED_BY_CLIENT',
  'CANCELLED_BY_BUSINESS',
  'COMPLETED',
] as const;

type StatusCounts = Record<(typeof STATUSES)[number], number>;

const counts = (partial: Partial<StatusCounts> = {}): StatusCounts => ({
  ...(Object.fromEntries(STATUSES.map((s) => [s, 0])) as StatusCounts),
  ...partial,
});

const stats = (overrides: Record<string, unknown> = {}) => ({
  range: { from: '2026-08-01', to: '2026-08-31', granularity: 'day' },
  totals: {
    bookings: 5,
    byStatus: counts({ COMPLETED: 3, PENDING: 2 }),
    completedBookings: 3,
    completedRevenueCents: 21000,
    bookedMinutes: 150,
    capacityMinutes: 2400,
    occupancyPercent: 6,
  },
  series: [
    { bucket: '2026-08-03', total: 3, byStatus: counts({ COMPLETED: 3 }) },
    { bucket: '2026-08-04', total: 2, byStatus: counts({ PENDING: 2 }) },
  ],
  employees: [
    {
      employeeId: 'e1',
      name: 'Marek Wiśniewski',
      bookings: 3,
      bookedMinutes: 150,
      capacityMinutes: 2400,
      occupancyPercent: 6,
    },
    {
      employeeId: 'e2',
      name: 'Zofia Bez Grafiku',
      bookings: 0,
      bookedMinutes: 0,
      capacityMinutes: 0,
      occupancyPercent: null,
    },
  ],
  topServices: [
    { serviceId: 's1', name: 'Strzyżenie męskie', bookings: 3, revenueCents: 21000 },
  ],
  ...overrides,
});

const setup = () => {
  const fixture = TestBed.createComponent(BusinessStats);
  const http = TestBed.inject(HttpTestingController);
  fixture.detectChanges(); // konstruktor odpala GET
  return { fixture, http };
};

/** Oczekujące żądanie statystyk; zakres jest częścią ścieżki, nie HttpParams. */
const statsRequest = (http: HttpTestingController) =>
  http.expectOne((r) => r.url.startsWith('/api/businesses/mine/stats'));

const rangeOf = (request: { url: string }): { from: string; to: string } => {
  const query = new URL(request.url, 'http://test').searchParams;
  return { from: query.get('from') ?? '', to: query.get('to') ?? '' };
};

const daysBetween = (from: string, to: string) =>
  (Date.parse(to) - Date.parse(from)) / 86_400_000;

/** Intl wstawia spację nierozdzielającą przed „zł" — normalizujemy, jak w price-pln.pipe.spec.ts. */
const text = (fixture: { nativeElement: HTMLElement }) =>
  (fixture.nativeElement.textContent ?? '').replace(/\s/g, ' ');

describe('BusinessStats', () => {
  beforeEach(async () => {
    // jsdom nie ma implementacji canvasa; wykres tego nie wymaga (rysuje się tylko, gdy
    // kontekst istnieje), a bez atrapy jsdom zaśmieca wyjście testów swoim „Not implemented"
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    await TestBed.configureTestingModule({
      imports: [BusinessStats],
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('domyślnie pobiera bieżący miesiąc (from = 1., to = ostatni dzień)', async () => {
    const { fixture, http } = setup();
    const req = statsRequest(http);

    const { from, to } = rangeOf(req.request);
    expect(from).toMatch(/^\d{4}-\d{2}-01$/);
    expect(to.slice(0, 7)).toBe(from.slice(0, 7));

    req.flush(stats());
    await fixture.whenStable();
  });

  it('pokazuje KPI, procent obłożenia i przychód w złotych', async () => {
    const { fixture, http } = setup();
    statsRequest(http).flush(stats());
    await fixture.whenStable();
    fixture.detectChanges();

    const content = text(fixture);
    expect(content).toContain('Rezerwacje');
    expect(content).toContain('Zrealizowane wizyty');
    expect(content).toContain('210 zł');
    expect(content).toContain('6%');
    expect(content).toContain('2 h 30 min');
  });

  it('rysuje serie tylko dla statusów, które wystąpiły', async () => {
    const { fixture, http } = setup();
    statsRequest(http).flush(stats());
    await fixture.whenStable();
    fixture.detectChanges();

    const headers = Array.from(
      fixture.nativeElement.querySelectorAll('table thead th'),
      (th) => (th as HTMLElement).textContent?.trim(),
    );
    // tabela sr-only wykresu: kategoria + Zakończona + Oczekująca, bez pustych statusów
    expect(headers).toContain('Zakończona');
    expect(headers).toContain('Oczekująca');
    expect(headers).not.toContain('Odrzucona');
  });

  it('pracownik bez grafiku dostaje „brak grafiku", nie 0%', async () => {
    const { fixture, http } = setup();
    statsRequest(http).flush(stats());
    await fixture.whenStable();
    fixture.detectChanges();

    const label = Array.from(
      fixture.nativeElement.querySelectorAll('[role="img"]'),
      (el) => (el as HTMLElement).getAttribute('aria-label'),
    ).find((value) => value?.includes('Zofia'));
    expect(label).toContain('brak grafiku');
  });

  it('każdy pasek obłożenia ma etykietę z liczbami (WCAG 1.4.1)', async () => {
    const { fixture, http } = setup();
    statsRequest(http).flush(stats());
    await fixture.whenStable();
    fixture.detectChanges();

    const label = Array.from(
      fixture.nativeElement.querySelectorAll('[role="img"]'),
      (el) => (el as HTMLElement).getAttribute('aria-label'),
    ).find((value) => value?.includes('Marek'));
    expect(label).toContain('6%');
    expect(label).toContain('2 h 30 min');
    expect(label).toContain('3 rezerwacji');
  });

  it('przełączenie na tydzień pobiera zakres poniedziałek–niedziela', async () => {
    const { fixture, http } = setup();
    statsRequest(http).flush(stats());
    await fixture.whenStable();
    fixture.detectChanges();

    const button = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
      (b) => b as HTMLButtonElement,
    ).find((b) => b.textContent?.trim() === 'Tydzień');
    button?.click();
    fixture.detectChanges();

    const req = statsRequest(http);
    const { from, to } = rangeOf(req.request);
    // 7 dni okna to 6 dni różnicy (obie granice włącznie)
    expect(daysBetween(from, to)).toBe(6);
    // poniedziałek: getUTCDay() === 1
    expect(new Date(from).getUTCDay()).toBe(1);
    req.flush(stats());
    await fixture.whenStable();
  });

  it('poprzedni okres cofa zakres o miesiąc', async () => {
    const { fixture, http } = setup();
    const first = statsRequest(http);
    const firstFrom = rangeOf(first.request).from;
    first.flush(stats());
    await fixture.whenStable();
    fixture.detectChanges();

    const prev = fixture.nativeElement.querySelector(
      'button[aria-label="Poprzedni okres"]',
    ) as HTMLButtonElement;
    prev.click();
    fixture.detectChanges();

    const req = statsRequest(http);
    const { from } = rangeOf(req.request);
    expect(from).not.toBe(firstFrom);
    expect(Date.parse(from)).toBeLessThan(Date.parse(firstFrom));
    // wciąż pierwszy dzień miesiąca — kotwica miesiąca nie przesuwa się o 30 dni
    expect(from).toMatch(/-01$/);
    req.flush(stats());
    await fixture.whenStable();
  });

  it('pusty okres pokazuje stan pusty zamiast wykresu', async () => {
    const { fixture, http } = setup();
    statsRequest(http).flush(
      stats({
        totals: {
          bookings: 0,
          byStatus: counts(),
          completedBookings: 0,
          completedRevenueCents: 0,
          bookedMinutes: 0,
          capacityMinutes: 2400,
          occupancyPercent: 0,
        },
        series: [],
        topServices: [],
      }),
    );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(text(fixture)).toContain('Brak rezerwacji w wybranym okresie.');
    expect(fixture.nativeElement.querySelector('canvas')).toBeNull();
    // obłożenie zostaje — grafik bez rezerwacji to nadal informacja
    expect(text(fixture)).toContain('Obłożenie pracowników');
  });

  it('błąd API pokazuje komunikat po polsku z możliwością ponowienia', async () => {
    const { fixture, http } = setup();
    statsRequest(http).flush(
      { statusCode: 404, code: 'NOT_FOUND', message: 'Nie znaleziono firmy' },
      { status: 404, statusText: 'Not Found' },
    );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(text(fixture)).toContain('Nie znaleziono firmy');

    const retry = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
      (b) => b as HTMLButtonElement,
    ).find((b) => b.textContent?.includes('Spróbuj ponownie'));
    retry?.click();
    fixture.detectChanges();

    statsRequest(http).flush(stats());
    await fixture.whenStable();
  });
});
