import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { settle } from '../testing-helpers';
import AppMap from '../../shared/map/map';
import BusinessProfile from './business-profile';
import BusinessReviews from './business-reviews';

// Podmiana mapy — Leaflet nie działa w jsdom (brak rozmiarów DOM).
@Component({ selector: 'app-map', template: '' })
class MapStub {
  readonly lat = input<number | null>(null);
  readonly lng = input<number | null>(null);
}

// Sekcja opinii strzela własnym żądaniem i ma osobny spec — tutaj tylko atrapa,
// żeby testy profilu nie musiały obsługiwać HTTP, którego nie sprawdzają.
@Component({ selector: 'app-business-reviews', template: '' })
class ReviewsStub {
  readonly slug = input.required<string>();
}

const MOCK = {
  id: 'b1',
  slug: 'test-slug',
  name: 'Studio Fryzur',
  description: 'Opis firmy',
  phone: null,
  street: 'Józefa 12',
  city: 'Kraków',
  postalCode: '31-056',
  lat: 50.05,
  lng: 19.94,
  cancellationHours: 24,
  // firma bez wizerunku (#155) — stan domyślny: gradient i monogram
  logoVersion: null,
  coverVersion: null,
  category: { id: 'c1', name: 'Salon fryzjerski', slug: 'fryzjer' },
  services: [
    {
      id: 's1',
      name: 'Strzyżenie męskie',
      description: 'Klasyczne',
      durationMin: 30,
      priceCents: 7000,
      depositType: null,
      depositValue: null,
      employees: [{ id: 'e1', name: 'Anna Kowalska' }],
    },
    {
      // zaliczka kwotowa (#50): 15 zł z 40 zł
      id: 's2',
      name: 'Broda',
      description: null,
      durationMin: 20,
      priceCents: 4000,
      depositType: 'FIXED',
      depositValue: 1500,
      employees: [],
    },
  ],
  employees: [{ id: 'e1', name: 'Anna Kowalska' }],
  avgRating: 4.9,
  reviewCount: 132,
};

async function setup(slug = 'test-slug') {
  await TestBed.configureTestingModule({
    imports: [BusinessProfile],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: ActivatedRoute,
        useValue: { paramMap: of(convertToParamMap({ slug })) },
      },
    ],
  })
    .overrideComponent(BusinessProfile, {
      remove: { imports: [AppMap, BusinessReviews] },
      add: { imports: [MapStub, ReviewsStub] },
    })
    .compileComponents();
  const fixture = TestBed.createComponent(BusinessProfile);
  const http = TestBed.inject(HttpTestingController);
  return { fixture, http };
}

describe('BusinessProfile', () => {
  it('renderuje profil: nazwę i cenę usługi w zł', async () => {
    const { fixture, http } = await setup();
    http.expectOne('/api/businesses/test-slug').flush(MOCK);
    await fixture.whenStable();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Studio Fryzur');
    expect(text.replace(/\s/g, ' ')).toContain('70 zł');
    expect(text).toContain('Anna Kowalska');
  });

  // AC #53: „kwota zaliczki widoczna przed potwierdzeniem" — profil jest wcześniej niż kreator
  it('pokazuje kwotę zaliczki tylko przy usłudze, która jej wymaga', async () => {
    const { fixture, http } = await setup();
    http.expectOne('/api/businesses/test-slug').flush(MOCK);
    await fixture.whenStable();
    fixture.detectChanges();

    // `article article` — kafelki usług siedzą w <article> profilu firmy, więc sam
    // `article` złapałby też kartę zbiorczą ze wszystkimi usługami naraz
    const cards = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll(
        'article article',
      ),
    ].map((c) => (c.textContent ?? '').replace(/\s/g, ' '));

    expect(cards.find((c) => c.includes('Broda'))).toContain(
      'Zaliczka 15 zł płatna online',
    );
    expect(cards.find((c) => c.includes('Strzyżenie męskie'))).not.toContain(
      'Zaliczka',
    );
  });

  // #155: logo firmy i okładka profilu są od siebie niezależne — firma może mieć jedno z dwóch
  it('firma bez wizerunku dostaje gradient i monogram', async () => {
    const { fixture, http } = await setup();
    http.expectOne('/api/businesses/test-slug').flush(MOCK);
    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('img')).toHaveLength(0);
    expect(root.querySelector('app-business-logo')?.textContent?.trim()).toBe('SF');
    // dekoracyjny pas nie ma czego ogłaszać czytnikowi ekranu
    expect(
      root.querySelector('.bg-brand-gradient')?.getAttribute('aria-hidden'),
    ).toBe('true');
  });

  it('firma z logo pokazuje je zamiast monogramu, zachowując gradient bez okładki', async () => {
    const { fixture, http } = await setup();
    http
      .expectOne('/api/businesses/test-slug')
      .flush({ ...MOCK, logoVersion: 'log1' });
    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const logo = root.querySelector('app-business-logo img');
    expect(logo?.getAttribute('src')).toBe('/api/businesses/b1/images/logo?v=log1');
    expect(logo?.getAttribute('alt')).toBe('Studio Fryzur');
    expect(root.querySelector('app-business-logo')?.textContent?.trim()).toBe('');
    expect(root.querySelector('.bg-brand-gradient')).not.toBeNull();
  });

  it('firma z okładką pokazuje ją zamiast gradientu, zachowując monogram bez logo', async () => {
    const { fixture, http } = await setup();
    http
      .expectOne('/api/businesses/test-slug')
      .flush({ ...MOCK, coverVersion: 'cov1' });
    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const cover = root.querySelector('img');
    expect(cover?.getAttribute('src')).toBe('/api/businesses/b1/images/cover?v=cov1');
    // okładka jest dekoracją w miejscu gradientu — nazwę firmy niesie nagłówek i alt logo
    expect(cover?.getAttribute('alt')).toBe('');
    expect(root.querySelector('.bg-brand-gradient')).toBeNull();
    expect(root.querySelector('app-business-logo')?.textContent?.trim()).toBe('SF');
  });

  // obraz można usunąć między pobraniem profilu a pobraniem bajtów — wtedy 404 nie może
  // zostawić w nagłówku pustej dziury po pasie
  it('okładka, która się nie wczytała, wraca do gradientu', async () => {
    const { fixture, http } = await setup();
    http
      .expectOne('/api/businesses/test-slug')
      .flush({ ...MOCK, coverVersion: 'cov1' });
    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    root.querySelector('img')!.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('.bg-brand-gradient')).not.toBeNull();
  });

  it('pokazuje średnią ocenę i liczbę opinii w nagłówku', async () => {
    const { fixture, http } = await setup();
    http.expectOne('/api/businesses/test-slug').flush(MOCK);
    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
      'Ocena 4,9 na 5, 132 opinie',
    );
    expect((root.textContent ?? '').replace(/\s+/g, ' ')).toContain('4,9 (132)');
  });

  it('firma bez ocen nie dostaje atrapy „0,0"', async () => {
    const { fixture, http } = await setup();
    http
      .expectOne('/api/businesses/test-slug')
      .flush({ ...MOCK, avgRating: null, reviewCount: 0 });
    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[role="img"]')).toBeNull();
    expect(root.textContent).not.toContain('0,0');
    // profil nadal się renderuje — brak ocen to nie brak firmy
    expect(root.textContent).toContain('Studio Fryzur');
  });

  it('CTA usługi prowadzi do wizarda rezerwacji z wybraną usługą', async () => {
    // prawdziwy router (nie stub trasy), bo sprawdzamy rozwiązanie linku względnego
    // — profil jest dzieckiem trasy ':slug', a wizard jego rodzeństwem
    await TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            path: ':slug',
            children: [
              { path: '', component: BusinessProfile },
              { path: 'rezerwacja', component: BusinessProfile },
            ],
          },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    })
      .overrideComponent(BusinessProfile, {
        remove: { imports: [AppMap, BusinessReviews] },
        add: { imports: [MapStub, ReviewsStub] },
      })
      .compileComponents();

    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/test-slug', BusinessProfile);
    TestBed.inject(HttpTestingController)
      .expectOne('/api/businesses/test-slug')
      .flush(MOCK);
    await settle(harness.fixture);
    harness.detectChanges();

    const root = harness.fixture.nativeElement as HTMLElement;
    const links = [...root.querySelectorAll('a[href*="rezerwacja"]')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/test-slug/rezerwacja?serviceId=s1',
    ]);
    // usługa bez przypisanych pracowników nie prowadzi do wizarda — byłaby ślepa uliczka
    expect(root.querySelector('button[disabled]')?.textContent?.trim()).toBe(
      'Zarezerwuj',
    );
  });

  it('404: pokazuje stronę „nie znaleziono", nie profil', async () => {
    const { fixture, http } = await setup('brak');
    http
      .expectOne('/api/businesses/brak')
      .flush('Nie znaleziono firmy', {
        status: 404,
        statusText: 'Not Found',
      });
    await fixture.whenStable();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Nie znaleziono strony');
    expect(text).not.toContain('Studio Fryzur');
  });
});
