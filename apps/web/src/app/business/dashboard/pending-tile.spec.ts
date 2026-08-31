import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatDate, formatTime } from '../../shared/business-time';
import type { CalendarBooking } from '../calendar/booking-details-dialog';
import { pendingRange } from '../pending-count-store';
import PendingTile from './pending-tile';

// dostęp do protected pól bez `any` — wzorzec z calendar.spec.ts
interface TestAccess {
  now: WritableSignal<number>;
}

// 12:00 czasu firmy (Europe/Warsaw, latem UTC+2)
const NOW = Date.parse('2026-08-31T10:00:00.000Z');

function mkBooking(overrides: Partial<CalendarBooking> = {}): CalendarBooking {
  return {
    id: 'b1',
    startsAt: '2026-08-31T11:00:00.000Z',
    endsAt: '2026-08-31T11:30:00.000Z',
    status: 'PENDING',
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

describe('PendingTile', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PendingTile],
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
    const fixture = TestBed.createComponent(PendingTile);
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

  /** Odpowiedź serwera + zamrożone „teraz", które dzieli próbkę na przyszłe i zaległe. */
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

  it('pyta dokładnie o pendingRange() — ten sam zakres co plakietka w nawigacji', () => {
    const { http } = setup();
    const req = bookingsReq(http);

    expect(rangeOf(req.request)).toEqual(pendingRange());

    req.flush([]);
  });

  it('do czasu odpowiedzi pokazuje stan ładowania', () => {
    const { el, http } = setup();

    expect(el.querySelector('[role="status"]')).not.toBeNull();

    bookingsReq(http).flush([]);
  });

  it('liczy wyłącznie rezerwacje PENDING z odpowiedzi', async () => {
    const s = setup();
    await respond(s, [
      mkBooking({ id: 'p1', status: 'PENDING' }),
      mkBooking({ id: 'p2', status: 'PENDING' }),
      mkBooking({ id: 'c', status: 'CONFIRMED' }),
      mkBooking({ id: 'd', status: 'DECLINED' }),
    ]);

    expect(text(s.el)).toContain('2 oczekujące rezerwacje');
    expect(items(s.el)).toHaveLength(2);
  });

  it('odmienia liczbę przez przypadki — jedna rezerwacja to nie „1 rezerwacje"', async () => {
    const s = setup();
    await respond(s, [mkBooking()]);

    expect(text(s.el)).toContain('1 oczekująca rezerwacja');
  });

  it('próbka pokazuje klienta, usługę i termin', async () => {
    const s = setup();
    await respond(s, [mkBooking()]);
    const item = text(items(s.el)[0]);

    expect(item).toContain('Jan Kowalski');
    expect(item).toContain('Strzyżenie');
    expect(item).toContain(formatDate('2026-08-31T11:00:00.000Z'));
    expect(item).toContain(formatTime('2026-08-31T11:00:00.000Z'));
  });

  it('próbka ma najwyżej trzy pozycje, choć liczba obejmuje wszystkie', async () => {
    const s = setup();
    await respond(
      s,
      Array.from({ length: 5 }, (_, i) =>
        mkBooking({ id: `b${i}`, startsAt: `2026-09-0${i + 1}T11:00:00.000Z` }),
      ),
    );

    expect(items(s.el)).toHaveLength(3);
    expect(text(s.el)).toContain('5 oczekujących rezerwacji');
  });

  it('próbka zaczyna od terminów jeszcze przed firmą, od najbliższego', async () => {
    const s = setup();
    await respond(s, [
      mkBooking({ id: 'za tydzień', startsAt: '2026-09-07T11:00:00.000Z' }),
      mkBooking({ id: 'jutro', startsAt: '2026-09-01T11:00:00.000Z' }),
      mkBooking({ id: 'zaległa', startsAt: '2026-07-01T11:00:00.000Z' }),
    ]);

    expect(items(s.el).map((li) => text(li))).toEqual([
      expect.stringContaining(formatDate('2026-09-01T11:00:00.000Z')),
      expect.stringContaining(formatDate('2026-09-07T11:00:00.000Z')),
      expect.stringContaining(formatDate('2026-07-01T11:00:00.000Z')),
    ]);
  });

  // pendingRange() sięga 60 dni wstecz, więc bez rozdziału na przyszłe i zaległe próbka
  // wypełniłaby się najstarszymi zaległościami i prośba na jutro nigdy by się nie pokazała
  it('zaległe wchodzą do próbki dopiero za przyszłymi, od najświeższej', async () => {
    const s = setup();
    await respond(s, [
      mkBooking({ id: 'stara', startsAt: '2026-07-01T11:00:00.000Z' }),
      mkBooking({ id: 'świeższa', startsAt: '2026-08-20T11:00:00.000Z' }),
    ]);

    expect(items(s.el).map((li) => text(li))).toEqual([
      expect.stringContaining(formatDate('2026-08-20T11:00:00.000Z')),
      expect.stringContaining(formatDate('2026-07-01T11:00:00.000Z')),
    ]);
  });

  it('prowadzi na listę oczekujących, a pozycje próbki nie są klikalne', async () => {
    const s = setup();
    await respond(s, [mkBooking()]);
    const links = [...s.el.querySelectorAll('a')];

    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('/business/pending');
    expect(s.el.querySelectorAll('li a, li button')).toHaveLength(0);
  });

  it('brak oczekujących to stan pusty, nie „0"', async () => {
    const s = setup();
    await respond(s, [mkBooking({ status: 'CONFIRMED' })]);

    expect(text(s.el)).toContain('Brak oczekujących rezerwacji.');
    expect(text(s.el)).toContain('Rozpatrz rezerwacje');
    expect(text(s.el)).not.toContain('0');
    expect(s.el.querySelector('[role="alert"]')).toBeNull();
  });

  it('błąd pobrania to alert z ponowieniem, nie pustka', async () => {
    const s = setup();
    await respondWithError(s);

    expect(s.el.querySelector('[role="alert"]')?.textContent).toBeTruthy();
    expect(s.el.querySelector('button')?.textContent?.trim()).toBe(
      'Spróbuj ponownie',
    );
    expect(text(s.el)).not.toContain('Brak oczekujących rezerwacji.');
  });

  it('ponowienie powtarza żądanie i pokazuje dane', async () => {
    const s = setup();
    await respondWithError(s);

    s.el.querySelector('button')?.click();
    s.fixture.detectChanges();
    await respond(s, [mkBooking()]);

    expect(s.el.querySelector('[role="alert"]')).toBeNull();
    expect(text(s.el)).toContain('1 oczekująca rezerwacja');
  });
});
