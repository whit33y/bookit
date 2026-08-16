import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { GeolocationResult, GeolocationService } from '../../shared/geolocation';
import { setValue, settle } from '../testing-helpers';
import Landing from './landing';

const CATEGORIES = [
  { id: 'c1', name: 'Fryzjer', slug: 'fryzjer' },
  { id: 'c2', name: 'Kosmetyczka', slug: 'kosmetyczka' },
];

async function setup(geoResult?: GeolocationResult) {
  await TestBed.configureTestingModule({
    imports: [Landing],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: GeolocationService,
        useValue: {
          getCurrentPosition: () =>
            Promise.resolve(geoResult ?? { ok: true, lat: 52.23, lng: 21.01 }),
        },
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(Landing);
  const http = TestBed.inject(HttpTestingController);
  return { fixture, http };
}

describe('Landing', () => {
  it('ładuje kategorie z API i pokazuje je w selekcie', async () => {
    const { fixture, http } = await setup();
    http.expectOne('/api/categories').flush(CATEGORIES);
    await fixture.whenStable();

    const options = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll(
        '#category option',
      ),
    ].map((o) => o.textContent?.trim());
    expect(options).toEqual(['Wszystkie kategorie', 'Fryzjer', 'Kosmetyczka']);
  });

  it('submit z wypełnionymi polami prowadzi do /search z parametrami w URL', async () => {
    const { fixture, http } = await setup();
    http.expectOne('/api/categories').flush(CATEGORIES);
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    const select = el.querySelector('#category') as HTMLSelectElement;
    select.value = 'fryzjer';
    select.dispatchEvent(new Event('change'));
    setValue(el.querySelector('#city') as HTMLInputElement, 'Kraków');
    setValue(el.querySelector('#q') as HTMLInputElement, 'strzyżenie');
    await fixture.whenStable();

    el.querySelector('form')?.dispatchEvent(
      new Event('submit', { cancelable: true }),
    );

    expect(navigate).toHaveBeenCalledWith(['/search'], {
      queryParams: { category: 'fryzjer', city: 'Kraków', q: 'strzyżenie' },
    });
  });

  it('submit z pustymi polami prowadzi do /search bez zbędnych parametrów', async () => {
    const { fixture, http } = await setup();
    http.expectOne('/api/categories').flush(CATEGORIES);
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    el.querySelector('form')?.dispatchEvent(
      new Event('submit', { cancelable: true }),
    );

    expect(navigate).toHaveBeenCalledWith(['/search'], { queryParams: {} });
  });

  it('"Szukaj w mojej okolicy" → sukces prowadzi do /search z lat/lng/radiusKm', async () => {
    const { fixture, http } = await setup({ ok: true, lat: 52.23, lng: 21.01 });
    http.expectOne('/api/categories').flush(CATEGORIES);
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    const radius = el.querySelector('#radiusKm') as HTMLSelectElement;
    radius.value = '25';
    radius.dispatchEvent(new Event('change'));

    el.querySelectorAll('button')[1].dispatchEvent(new MouseEvent('click'));
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith(['/search'], {
      queryParams: { lat: '52.23', lng: '21.01', radiusKm: '25' },
    });
  });

  it('"Szukaj w mojej okolicy" → odmowa dostępu pokazuje komunikat i nie nawiguje', async () => {
    const { fixture, http } = await setup({ ok: false, reason: 'denied' });
    http.expectOne('/api/categories').flush(CATEGORIES);
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    el.querySelectorAll('button')[1].dispatchEvent(new MouseEvent('click'));
    await fixture.whenStable();

    expect(el.textContent).toContain('Odmówiono dostępu do lokalizacji');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('"Szukaj w mojej okolicy" → timeout pokazuje komunikat i nie nawiguje', async () => {
    const { fixture, http } = await setup({ ok: false, reason: 'timeout' });
    http.expectOne('/api/categories').flush(CATEGORIES);
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    el.querySelectorAll('button')[1].dispatchEvent(new MouseEvent('click'));
    await fixture.whenStable();

    expect(el.textContent).toContain('upłynął czas oczekiwania');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('"Szukaj w mojej okolicy" → odrzucony Promise pokazuje komunikat i odblokowuje przycisk', async () => {
    await TestBed.configureTestingModule({
      imports: [Landing],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: GeolocationService,
          useValue: {
            getCurrentPosition: () => Promise.reject(new Error('boom')),
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(Landing);
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/categories').flush(CATEGORIES);
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    const button = el.querySelectorAll('button')[1] as HTMLButtonElement;
    button.dispatchEvent(new MouseEvent('click'));
    await fixture.whenStable();

    expect(el.textContent).toContain('Twoja przeglądarka nie obsługuje geolokalizacji');
    expect(button.disabled).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('ma dokładnie jeden <h1> — nagłówek hero', async () => {
    const { fixture, http } = await setup();
    http.expectOne('/api/categories').flush(CATEGORIES);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    const headings = el.querySelectorAll('h1');
    expect(headings.length).toBe(1);
    expect(headings[0].textContent).toContain('Zarezerwuj wizytę');
  });

  it('renderuje kategorie jako linki do /search z parametrem category', async () => {
    const { fixture, http } = await setup();
    http.expectOne('/api/categories').flush(CATEGORIES);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    const tiles = [
      ...el.querySelectorAll<HTMLAnchorElement>('[aria-labelledby="landing-categories-h"] a'),
    ];
    expect(tiles.map((a) => a.getAttribute('href'))).toEqual([
      '/search?category=fryzjer',
      '/search?category=kosmetyczka',
    ]);
    expect(tiles.map((a) => a.textContent?.trim().replace(/\s*›$/, ''))).toEqual([
      'Fryzjer',
      'Kosmetyczka',
    ]);
  });

  it('błąd /categories chowa sekcję kategorii, ale formularz nadal nawiguje', async () => {
    const { fixture, http } = await setup();
    http
      .expectOne('/api/categories')
      .flush(null, { status: 500, statusText: 'Server Error' });
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('[aria-labelledby="landing-categories-h"]')).toBeNull();
    expect(el.textContent).toContain('Nie udało się wczytać listy kategorii');

    setValue(el.querySelector('#city') as HTMLInputElement, 'Kraków');
    await fixture.whenStable();
    el.querySelector('form')?.dispatchEvent(
      new Event('submit', { cancelable: true }),
    );

    expect(navigate).toHaveBeenCalledWith(['/search'], {
      queryParams: { city: 'Kraków' },
    });
  });

  it('pokazuje sekcję „Jak to działa" z trzema krokami', async () => {
    const { fixture, http } = await setup();
    http.expectOne('/api/categories').flush(CATEGORIES);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    const section = el.querySelector('[aria-labelledby="landing-how-h"]');
    expect(section?.querySelector('#landing-how-h')?.textContent).toContain(
      'Jak to działa',
    );
    expect(section?.querySelectorAll('li').length).toBe(3);
    expect(section?.textContent).toContain('Znajdź firmę');
    expect(section?.textContent).toContain('Wybierz termin');
    expect(section?.textContent).toContain('Zarezerwuj');
  });

  it('pokazuje sekcję CTA dla firm z linkiem do /create-business', async () => {
    const { fixture, http } = await setup();
    http.expectOne('/api/categories').flush(CATEGORIES);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    const section = el.querySelector('[aria-labelledby="landing-business-h"]');
    const cta = section?.querySelector('a');
    // przez /register z returnUrl, nie prosto na /create-business: ta trasa jest za authGuard,
    // a CTA mówi do niezalogowanych — inaczej lądowaliby na gołym formularzu logowania
    expect(cta?.getAttribute('href')).toBe(
      '/register?returnUrl=%2Fcreate-business',
    );
    expect(cta?.textContent?.trim()).toBe('Załóż profil firmy');
  });

  it('trzyma miejsce na kategorie w trakcie ładowania, potem podmienia je na linki', async () => {
    const { fixture, http } = await setup();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    const selector = '[aria-labelledby="landing-categories-h"]';
    expect(el.querySelector(selector)?.getAttribute('aria-busy')).toBe('true');
    // placeholdery zajmują miejsce, ale nie są jeszcze celami nawigacji
    expect(el.querySelectorAll(`${selector} li`).length).toBeGreaterThan(0);
    expect(el.querySelectorAll(`${selector} a`).length).toBe(0);

    http.expectOne('/api/categories').flush(CATEGORIES);
    await settle(fixture);

    expect(el.querySelector(selector)?.hasAttribute('aria-busy')).toBe(false);
    expect(el.querySelectorAll(`${selector} a`).length).toBe(2);
  });
});
