import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import BusinessDashboard from './dashboard';

const fakeJwt = (payload: object) =>
  `header.${btoa(JSON.stringify(payload))}.signature`;

const OWNER_TILES = [
  'Kalendarz',
  'Oczekujące rezerwacje',
  'Statystyki',
  'Usługi',
  'Pracownicy',
  'Ustawienia firmy',
];

/** Trasy spod `roleGuard('OWNER')` w business.routes.ts — dla EMPLOYEE byłyby martwe. */
const OWNER_ONLY_LINKS = [
  '/business/stats',
  '/business/services',
  '/business/employees',
  '/business/settings',
];

function setup(role: 'OWNER' | 'EMPLOYEE') {
  localStorage.setItem(
    'bookit.accessToken',
    fakeJwt({ sub: '1', email: 'a@b.pl', role }),
  );
  const fixture = TestBed.createComponent(BusinessDashboard);
  fixture.detectChanges();
  // kafelki z podglądem (#133) pobierają dane same, każdy własnym żądaniem — pulpit ich nie
  // koordynuje, więc test tylko domyka to, co poszło w eter
  for (const req of TestBed.inject(HttpTestingController).match((r) =>
    r.url.startsWith('/api/businesses/mine/bookings'),
  )) {
    req.flush([]);
  }
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

const tiles = (el: HTMLElement) => [
  ...el.querySelectorAll('app-dashboard-tile'),
];
/** Sam tytuł — bez dekoracyjnej strzałki, którą kafelek trzyma wewnątrz linku. */
const headings = (el: HTMLElement) =>
  tiles(el).map(
    (tile) =>
      tile.querySelector('h2')?.textContent?.replace('\u203a', '').trim() ?? '',
  );
const hrefs = (el: HTMLElement) =>
  [...el.querySelectorAll('a')].map((a) => a.getAttribute('href'));

/** Punkty łamania siatki są tylko w klasach — jsdom nie liczy layoutu, więc sprawdzamy zapis
 *  (ten sam kompromis co w pagination.spec.ts). */
function expectThreeColumnGrid(el: HTMLElement): void {
  const grid = el.querySelector('ul')?.className ?? '';

  expect(grid).toContain('grid-cols-1');
  expect(grid).toContain('sm:grid-cols-2');
  expect(grid).toContain('lg:grid-cols-3');
}

describe('BusinessDashboard', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [BusinessDashboard],
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

  it('OWNER widzi sześć kafelków w ustalonej kolejności', () => {
    const { el } = setup('OWNER');

    expect(headings(el)).toEqual(OWNER_TILES);
  });

  it('EMPLOYEE widzi tylko kalendarz i oczekujące rezerwacje', () => {
    const { el } = setup('EMPLOYEE');

    expect(headings(el)).toEqual(['Kalendarz', 'Oczekujące rezerwacje']);
  });

  it('EMPLOYEE nie dostaje martwych linków do stron spod roleGuard(OWNER)', () => {
    const { el } = setup('EMPLOYEE');

    for (const link of OWNER_ONLY_LINKS) {
      expect(hrefs(el)).not.toContain(link);
    }
  });

  it('siatka ma 1 kolumnę na telefonie, 2 na tablecie i 3 na desktopie', () => {
    expectThreeColumnGrid(setup('OWNER').el);
  });

  it('rola nie zmienia liczby kolumn — EMPLOYEE dostaje tę samą siatkę', () => {
    expectThreeColumnGrid(setup('EMPLOYEE').el);
  });

  it('każdy kafelek to jeden przystanek tabulatora, bez linku w linku', () => {
    const { el } = setup('OWNER');

    expect(el.querySelectorAll('a')).toHaveLength(OWNER_TILES.length);
    expect(el.querySelectorAll('a a')).toHaveLength(0);
  });
});
