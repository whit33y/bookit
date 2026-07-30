import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { GeolocationResult, GeolocationService } from '../../shared/geolocation';
import { setValue } from '../testing-helpers';
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
});
