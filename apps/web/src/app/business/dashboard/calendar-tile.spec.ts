import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { todayInBusinessTz } from '../../shared/business-time';
import {
  STATUS_CLASSES,
  type CalendarBooking,
} from '../calendar/booking-details-dialog';
import { addDays, formatDayLabel } from '../calendar/calendar-date';
import CalendarTile from './calendar-tile';

// dostęp do protected pól bez `any` — wzorzec z calendar.spec.ts
interface TestAccess {
  now: WritableSignal<number>;
}

// 12:00 czasu firmy (Europe/Warsaw, latem UTC+2) — środek dnia, żeby „przed" i „po"
// mieściły się w tej samej dobie kalendarzowej firmy
const NOW = Date.parse('2026-08-31T10:00:00.000Z');
const TODAY = '2026-08-31';

function mkBooking(overrides: Partial<CalendarBooking> = {}): CalendarBooking {
  return {
    id: 'b1',
    startsAt: '2026-08-31T11:00:00.000Z',
    endsAt: '2026-08-31T11:30:00.000Z',
    status: 'CONFIRMED',
    clientNote: null,
    client: { firstName: 'Jan', lastName: 'Kowalski', phone: null },
    service: {
      id: 's1',
      name: 'Strzyżenie',
      description: null,
      durationMin: 30,
      priceCents: 8000,
    },
    employee: { id: 'e1', name: 'Ola' },
    ...overrides,
  };
}

describe('CalendarTile', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CalendarTile],
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

  function setup() {
    const fixture = TestBed.createComponent(CalendarTile);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    return {
      fixture,
      http,
      el: fixture.nativeElement as HTMLElement,
      comp: fixture.componentInstance as unknown as TestAccess,
    };
  }

  const bookingsReq = (http: HttpTestingController) =>
    http.expectOne((r) => r.url.startsWith('/api/businesses/mine/bookings'));

  /** Zakres jest częścią ścieżki, nie HttpParams — jak w stats.spec.ts. */
  const rangeOf = (request: { url: string }) => {
    const query = new URL(request.url, 'http://test').searchParams;
    return { from: query.get('from') ?? '', to: query.get('to') ?? '' };
  };

  /** `firstValueFrom` rozwiązuje się w mikrozadaniu, więc po `flush()` trzeba oddać kolejkę. */
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  /** Odpowiedź serwera + zamrożone „teraz", żeby odcięcie agendy nie zależało od zegara. */
  async function respond(
    {
      fixture,
      http,
      comp,
    }: Pick<ReturnType<typeof setup>, 'fixture' | 'http' | 'comp'>,
    bookings: CalendarBooking[],
  ): Promise<void> {
    bookingsReq(http).flush(bookings);
    await tick();
    comp.now.set(NOW);
    fixture.detectChanges();
  }

  /** Nieudane pobranie — koperta błędu jak z `ApiExceptionFilter`. */
  async function respondWithError({
    fixture,
    http,
  }: Pick<ReturnType<typeof setup>, 'fixture' | 'http'>): Promise<void> {
    bookingsReq(http).flush(
      { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Błąd' },
      { status: 500, statusText: 'Server Error' },
    );
    await tick();
    fixture.detectChanges();
  }

  const items = (el: HTMLElement) => [...el.querySelectorAll('li')];
  const text = (el: HTMLElement) => el.textContent ?? '';

  it('pyta o zakres zaczynający się dziś i sięgający dalej niż dziś', () => {
    const { http } = setup();
    const req = bookingsReq(http);
    const { from, to } = rangeOf(req.request);

    expect(from).toBe(todayInBusinessTz());
    expect(to > from).toBe(true);

    req.flush([]);
  });

  it('do czasu odpowiedzi pokazuje stan ładowania', () => {
    const { el, http } = setup();

    expect(el.querySelector('[role="status"]')).not.toBeNull();

    bookingsReq(http).flush([]);
  });

  it('nagłówek liczy wszystkie dzisiejsze wizyty, także te sprzed „teraz"', async () => {
    const s = setup();
    await respond(s, [
      mkBooking({ id: 'rano', startsAt: '2026-08-31T07:00:00.000Z' }),
      mkBooking({ id: 'po', startsAt: '2026-08-31T14:00:00.000Z' }),
    ]);

    expect(text(s.el)).toContain('Dziś: 2 wizyty');
  });

  it('nagłówek mówi „Dziś brak wizyt", gdy dzień jest pusty, a agenda ma co pokazać', async () => {
    const s = setup();
    await respond(s, [
      mkBooking({ id: 'jutro', startsAt: '2026-09-01T07:00:00.000Z' }),
    ]);

    expect(text(s.el)).toContain('Dziś brak wizyt');
    expect(items(s.el)).toHaveLength(1);
  });

  it('agenda liczy się od teraz, nie od początku dnia', async () => {
    const s = setup();
    await respond(s, [
      mkBooking({
        id: 'rano',
        startsAt: '2026-08-31T07:00:00.000Z',
        service: { ...mkBooking().service, name: 'Poranna' },
      }),
      mkBooking({
        id: 'po',
        startsAt: '2026-08-31T14:00:00.000Z',
        service: { ...mkBooking().service, name: 'Popołudniowa' },
      }),
    ]);

    expect(items(s.el)).toHaveLength(1);
    expect(text(s.el)).toContain('Popołudniowa');
    expect(text(s.el)).not.toContain('Poranna');
  });

  it('pokazuje najwyżej trzy najbliższe wizyty', async () => {
    const s = setup();
    await respond(
      s,
      Array.from({ length: 5 }, (_, i) =>
        mkBooking({ id: `b${i}`, startsAt: `2026-08-31T1${i + 1}:00:00.000Z` }),
      ),
    );

    expect(items(s.el)).toHaveLength(3);
  });

  it('pokazuje CONFIRMED i PENDING, pomija pozostałe statusy', async () => {
    const s = setup();
    await respond(s, [
      mkBooking({ id: 'confirmed', status: 'CONFIRMED' }),
      mkBooking({ id: 'pending', status: 'PENDING' }),
      mkBooking({ id: 'declined', status: 'DECLINED' }),
      mkBooking({ id: 'cancelled', status: 'CANCELLED_BY_CLIENT' }),
      mkBooking({ id: 'completed', status: 'COMPLETED' }),
    ]);

    expect(items(s.el)).toHaveLength(2);
    expect(text(s.el)).toContain('Dziś: 2 wizyty');
  });

  it('każda pozycja ma kropkę statusu i jego nazwę dla czytnika ekranu', async () => {
    const s = setup();
    await respond(s, [
      mkBooking({ id: 'confirmed', status: 'CONFIRMED' }),
      mkBooking({ id: 'pending', status: 'PENDING' }),
    ]);
    const dots = [...s.el.querySelectorAll('li span[aria-hidden="true"]')];

    expect(dots.map((d) => d.className)).toEqual([
      expect.stringContaining('bg-emerald-700'),
      expect.stringContaining('bg-amber-700'),
    ]);
    expect(
      [...s.el.querySelectorAll('li .sr-only')].map((s) => s.textContent),
    ).toEqual(['Potwierdzona', 'Oczekująca']);
  });

  // AC #133 „odcienie jak w STATUS_CLASSES": mapa kropek w calendar-tile.ts jest wypisana
  // wprost (Tailwind generuje tylko klasy, które widzi w źródle jako literały), więc to test
  // trzyma ją przy palecie — zmiana STATUS_CLASSES bez zmiany kropek zapala się tutaj
  it('kropki biorą odcienie z palety statusów', async () => {
    const s = setup();
    await respond(s, [
      mkBooking({ id: 'confirmed', status: 'CONFIRMED' }),
      mkBooking({ id: 'pending', status: 'PENDING' }),
    ]);
    const dots = [...s.el.querySelectorAll('li span[aria-hidden="true"]')];
    const shadeOf = (status: 'CONFIRMED' | 'PENDING') =>
      STATUS_CLASSES[status].split(' ').find((c) => c.startsWith('text-'));

    expect(dots[0].className).toContain(
      shadeOf('CONFIRMED')?.replace('text-', 'bg-'),
    );
    expect(dots[1].className).toContain(
      shadeOf('PENDING')?.replace('text-', 'bg-'),
    );
  });

  it('wizyta spoza dzisiejszego dnia dostaje widoczną etykietę dnia', async () => {
    const s = setup();
    await respond(s, [
      mkBooking({ id: 'dziś', startsAt: '2026-08-31T14:00:00.000Z' }),
      mkBooking({ id: 'jutro', startsAt: '2026-09-01T07:00:00.000Z' }),
    ]);
    const [today, tomorrow] = items(s.el);

    expect(tomorrow.textContent).toContain(formatDayLabel(addDays(TODAY, 1)));
    expect(today.textContent).not.toContain(formatDayLabel(TODAY));
  });

  it('prowadzi na kalendarz, a pozycje agendy nie są klikalne', async () => {
    const s = setup();
    await respond(s, [mkBooking()]);
    const links = [...s.el.querySelectorAll('a')];

    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('/business/calendar');
    expect(s.el.querySelectorAll('li a, li button')).toHaveLength(0);
  });

  it('brak wizyt to stan pusty, nie „Dziś: 0 wizyt"', async () => {
    const s = setup();
    await respond(s, []);

    expect(text(s.el)).toContain('Brak wizyt w najbliższych dniach.');
    expect(text(s.el)).toContain('Otwórz kalendarz');
    expect(text(s.el)).not.toContain('0');
    expect(s.el.querySelector('[role="alert"]')).toBeNull();
  });

  it('dzień z samymi odbytymi wizytami zostaje treścią — nagłówek wciąż niesie kontekst dnia', async () => {
    const s = setup();
    await respond(s, [
      mkBooking({ id: 'rano', startsAt: '2026-08-31T07:00:00.000Z' }),
    ]);

    expect(text(s.el)).toContain('Dziś: 1 wizyta');
    expect(text(s.el)).toContain('Brak kolejnych wizyt.');
  });

  it('błąd pobrania to alert z ponowieniem, nie pustka', async () => {
    const s = setup();
    await respondWithError(s);

    expect(s.el.querySelector('[role="alert"]')?.textContent).toBeTruthy();
    expect(s.el.querySelector('button')?.textContent?.trim()).toBe(
      'Spróbuj ponownie',
    );
    expect(s.el.textContent).not.toContain('Brak wizyt w najbliższych dniach.');
  });

  it('ponowienie powtarza żądanie i pokazuje dane', async () => {
    const s = setup();
    await respondWithError(s);

    s.el.querySelector('button')?.click();
    s.fixture.detectChanges();
    await respond(s, [
      mkBooking({ id: 'po', startsAt: '2026-08-31T14:00:00.000Z' }),
    ]);

    expect(s.el.querySelector('[role="alert"]')).toBeNull();
    expect(items(s.el)).toHaveLength(1);
  });
});
