import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StatsTotals } from '../stats/stats-response';
import { businessStatsResponse } from '../stats/testing-helpers';
import StatsTile from './stats-tile';

const setup = () => {
  const fixture = TestBed.createComponent(StatsTile);
  const http = TestBed.inject(HttpTestingController);
  fixture.detectChanges(); // konstruktor odpala GET
  return { fixture, http };
};

const statsRequest = (http: HttpTestingController) =>
  http.expectOne((r) => r.url.startsWith('/api/businesses/mine/stats'));

const rangeOf = (request: { url: string }) => {
  const query = new URL(request.url, 'http://test').searchParams;
  return { from: query.get('from') ?? '', to: query.get('to') ?? '' };
};

/** Intl wstawia spację nierozdzielającą przed „zł" — normalizujemy, jak w stats.spec.ts. */
const text = (fixture: ComponentFixture<StatsTile>) =>
  ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(
    /\s/g,
    ' ',
  );

async function flush(
  fixture: ComponentFixture<StatsTile>,
  http: HttpTestingController,
  overrides: Partial<StatsTotals> = {},
) {
  statsRequest(http).flush(businessStatsResponse(overrides));
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('StatsTile', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StatsTile],
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

  it('pyta o bieżący miesiąc — dokładnie o zakres presetu „month"', async () => {
    const { fixture, http } = setup();
    const req = statsRequest(http);

    const { from, to } = rangeOf(req.request);
    expect(from).toMatch(/^\d{4}-\d{2}-01$/);
    expect(to.slice(0, 7)).toBe(from.slice(0, 7));

    req.flush(businessStatsResponse());
    await fixture.whenStable();
  });

  it('mapuje odpowiedź na trzy liczby: rezerwacje, przychód i obłożenie', async () => {
    const { fixture, http } = setup();
    await flush(fixture, http);

    const content = text(fixture);
    expect(content).toContain('12');
    expect(content).toContain('210 zł');
    expect(content).toContain('6%');
  });

  it('brak grafiku pokazuje „—", a nie 0%', async () => {
    const { fixture, http } = setup();
    await flush(fixture, http, { occupancyPercent: null });

    const content = text(fixture);
    expect(content).toContain('—');
    expect(content).not.toContain('0%');
    // sam myślnik nic nie mówi czytnikowi ekranu — powód stoi obok, tekstem
    expect(content).toContain('brak grafiku');
  });

  it('zero rezerwacji to liczba, nie stan pusty', async () => {
    const { fixture, http } = setup();
    await flush(fixture, http, { bookings: 0, completedRevenueCents: 0 });

    const content = text(fixture);
    expect(content).toContain('0 zł');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('app-empty-state'),
    ).toBeNull();
  });

  it('do czasu odpowiedzi pokazuje stan ładowania, nie zera', async () => {
    const { fixture, http } = setup();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('app-loading-state')).not.toBeNull();
    expect(text(fixture)).not.toContain('zł');

    await flush(fixture, http);
    expect(el.querySelector('app-loading-state')).toBeNull();
  });

  it('błąd pokazuje komunikat i ponowienie, które pobiera dane jeszcze raz', async () => {
    const { fixture, http } = setup();
    statsRequest(http).flush(
      {
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        message: 'Coś poszło nie tak',
      },
      { status: 500, statusText: 'Server Error' },
    );
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-error-state')).not.toBeNull();
    expect(text(fixture)).toContain('Coś poszło nie tak');

    el.querySelector('app-error-state button')?.dispatchEvent(
      new Event('click'),
    );
    fixture.detectChanges();

    await flush(fixture, http);
    expect(el.querySelector('app-error-state')).toBeNull();
    expect(text(fixture)).toContain('210 zł');
  });

  it('prowadzi na /business/stats i nie ma własnego wyboru zakresu', async () => {
    const { fixture, http } = setup();
    await flush(fixture, http);

    const el = fixture.nativeElement as HTMLElement;
    const links = [...el.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/business/stats',
    ]);
    // jedyny przycisk kafelka to ponowienie po błędzie — w treści nie ma żadnego
    expect(el.querySelectorAll('button')).toHaveLength(0);
  });
});
