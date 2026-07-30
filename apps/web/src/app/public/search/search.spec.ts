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
import Search from './search';

// Podmiana mapy — Leaflet nie działa w jsdom (brak rozmiarów DOM).
@Component({ selector: 'app-map', template: '' })
class MapStub {
  readonly lat = input<number | null>(null);
  readonly lng = input<number | null>(null);
  readonly pins = input<MapPin[]>([]);
  readonly activeId = input<string | null>(null);
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
    expect(alert?.textContent).toContain('Coś poszło nie tak');
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
});
