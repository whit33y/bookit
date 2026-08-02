import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component, input, output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { of } from 'rxjs';
import AppMap, { MapPin } from '../../shared/map/map';
import { settle } from '../testing-helpers';
import Search from './search';

// Podmiana mapy — Leaflet nie działa w jsdom (brak rozmiarów DOM).
@Component({ selector: 'app-map', template: '' })
class MapStub {
  readonly lat = input<number | null>(null);
  readonly lng = input<number | null>(null);
  readonly pins = input<MapPin[]>([]);
  readonly activeId = input<string | null>(null);
  readonly userLocation = input<{ lat: number; lng: number } | null>(null);
  readonly ariaLabel = input('');
  readonly heightClass = input('h-64');
  readonly pinClick = output<string>();
}

const RESPONSE = {
  items: [
    {
      id: 'b1',
      slug: 'salon-x',
      name: 'Salon X',
      city: 'Warszawa',
      street: 'Testowa 1',
      lat: 52.23,
      lng: 21.01,
      category: { id: 'c1', name: 'Fryzjer', slug: 'fryzjer' },
      distanceKm: 3.14,
      avgRating: 4.5,
      reviewCount: 12,
    },
    {
      id: 'b2',
      slug: 'salon-y',
      name: 'Salon Y',
      city: 'Warszawa',
      street: 'Inna 2',
      lat: 52.24,
      lng: 21.02,
      category: { id: 'c1', name: 'Fryzjer', slug: 'fryzjer' },
      // firma bez recenzji — backend zwraca null, nigdy 0
      avgRating: null,
      reviewCount: 0,
    },
  ],
  total: 2,
  page: 1,
  limit: 20,
};

async function setup(params: Record<string, string> = {}) {
  await TestBed.configureTestingModule({
    imports: [Search],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: ActivatedRoute,
        useValue: { queryParamMap: of(convertToParamMap(params)) },
      },
    ],
  })
    .overrideComponent(Search, {
      remove: { imports: [AppMap] },
      add: { imports: [MapStub] },
    })
    .compileComponents();
  const fixture = TestBed.createComponent(Search);
  const http = TestBed.inject(HttpTestingController);
  return { fixture, http };
}

describe('Search', () => {
  it('woła /businesses z parametrami z URL i renderuje karty wyników', async () => {
    const { fixture, http } = await setup({ category: 'fryzjer', city: 'Warszawa' });
    const req = http.expectOne(
      (r) => r.url.startsWith('/api/businesses?') && !r.url.includes('/mine'),
    );
    expect(req.request.url).toBe(
      '/api/businesses?' + new URLSearchParams({ category: 'fryzjer', city: 'Warszawa' }).toString(),
    );
    req.flush(RESPONSE);
    await fixture.whenStable();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Salon X');
    expect(text).toContain('Salon Y');
    expect(text).toContain('Znaleziono 2 firm');
    expect(text.replace(/\s/g, ' ')).toContain('3,1 km');
  });

  it('karta z ocenami pokazuje gwiazdki i liczbę opinii, karta bez ocen nic', async () => {
    const { fixture, http } = await setup({ city: 'Warszawa' });
    http
      .expectOne((r) => r.url.startsWith('/api/businesses?') && !r.url.includes('/mine'))
      .flush(RESPONSE);
    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const ratings = [...root.querySelectorAll('[role="img"]')];
    // dokładnie jedna karta z oceną — druga firma nie ma recenzji (AC #49: bez atrapy „0.0")
    expect(ratings).toHaveLength(1);
    expect(ratings[0].getAttribute('aria-label')).toBe('Ocena 4,5 na 5, 12 opinii');

    const cardY = root.querySelector('#card-b2');
    expect(cardY?.querySelector('[role="img"]')).toBeNull();
    expect(cardY?.textContent).not.toContain('0,0');
  });

  it('brak wyników → czytelny komunikat zamiast pustej listy', async () => {
    const { fixture, http } = await setup();
    http
      .expectOne((r) => r.url.startsWith('/api/businesses'))
      .flush({ items: [], total: 0, page: 1, limit: 20 });
    await fixture.whenStable();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Brak wyników');
  });

  it('błąd serwera → alert zamiast listy', async () => {
    const { fixture, http } = await setup();
    http
      .expectOne((r) => r.url.startsWith('/api/businesses'))
      .flush('Błąd', { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();

    const alert = (fixture.nativeElement as HTMLElement).querySelector(
      '[role="alert"]',
    );
    expect(alert?.textContent).toContain('Wystąpił nieoczekiwany błąd serwera');
  });

  it('brak sieci → komunikat o połączeniu i retry powtarza to samo zapytanie', async () => {
    const { fixture, http } = await setup({ city: 'Warszawa' });
    // status 0 = żądanie nie doszło (offline, ubity serwer) — nie ma ciała odpowiedzi
    http
      .expectOne((r) => r.url.startsWith('/api/businesses'))
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(
      'Brak połączenia z serwerem',
    );

    const retry = Array.from(el.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === 'Spróbuj ponownie',
    ) as HTMLButtonElement;
    retry.click();
    await fixture.whenStable();

    // te same parametry co pierwotne zapytanie — retry nie gubi filtrów z adresu
    const retried = http.expectOne((r) => r.url.startsWith('/api/businesses'));
    expect(retried.request.url).toContain('city=Warszawa');
    retried.flush(RESPONSE);
    await settle(fixture);

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Salon X');
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  it('klik pinezki na mapie podświetla odpowiednią kartę na liście', async () => {
    const { fixture, http } = await setup();
    http
      .expectOne((r) => r.url.startsWith('/api/businesses'))
      .flush(RESPONSE);
    await fixture.whenStable();

    const mapStub = fixture.debugElement.query(
      By.directive(MapStub),
    ).componentInstance as MapStub;
    mapStub.pinClick.emit('b2');
    fixture.detectChanges();

    const card = (fixture.nativeElement as HTMLElement).querySelector(
      '#card-b2',
    );
    expect(card?.className).toContain('border-brand-600');
    const otherCard = (fixture.nativeElement as HTMLElement).querySelector(
      '#card-b1',
    );
    expect(otherCard?.className).not.toContain('border-brand-600');
  });

  it('lat/lng z URL trafiają do mapy jako userLocation', async () => {
    const { fixture, http } = await setup({ lat: '52.25', lng: '21.05' });
    http
      .expectOne((r) => r.url.startsWith('/api/businesses'))
      .flush(RESPONSE);
    await fixture.whenStable();

    const mapStub = fixture.debugElement.query(
      By.directive(MapStub),
    ).componentInstance as MapStub;
    expect(mapStub.userLocation()).toEqual({ lat: 52.25, lng: 21.05 });
  });

  it('brak lat/lng w URL → userLocation na mapie jest null', async () => {
    const { fixture, http } = await setup();
    http
      .expectOne((r) => r.url.startsWith('/api/businesses'))
      .flush(RESPONSE);
    await fixture.whenStable();

    const mapStub = fixture.debugElement.query(
      By.directive(MapStub),
    ).componentInstance as MapStub;
    expect(mapStub.userLocation()).toBeNull();
  });

  it('pusty lat w URL → userLocation na mapie jest null (nie {lat: 0})', async () => {
    const { fixture, http } = await setup({ lat: '', lng: '21.05' });
    http
      .expectOne((r) => r.url.startsWith('/api/businesses'))
      .flush(RESPONSE);
    await fixture.whenStable();

    const mapStub = fixture.debugElement.query(
      By.directive(MapStub),
    ).componentInstance as MapStub;
    expect(mapStub.userLocation()).toBeNull();
  });

  it('lat/lng spoza zakresu geograficznego → userLocation na mapie jest null', async () => {
    const { fixture, http } = await setup({ lat: '999', lng: '21.05' });
    http
      .expectOne((r) => r.url.startsWith('/api/businesses'))
      .flush(RESPONSE);
    await fixture.whenStable();

    const mapStub = fixture.debugElement.query(
      By.directive(MapStub),
    ).componentInstance as MapStub;
    expect(mapStub.userLocation()).toBeNull();
  });
});
