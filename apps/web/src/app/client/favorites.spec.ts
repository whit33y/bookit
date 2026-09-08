import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { signInAs, verifyIgnoringProfile } from '../core/auth/auth-testing';
import { setLocale } from '../core/i18n/locale';
import { settle } from '../public/testing-helpers';
import Favorites, { type FavoriteBusiness } from './favorites';

@Component({ selector: 'app-blank', template: '' })
class Blank {}

/** Pozycja `GET /favorites` — pełny kształt kontraktu, testy nadpisują tylko badane pole. */
const favorite = (overrides: Partial<FavoriteBusiness> = {}): FavoriteBusiness => ({
  id: 'biz1',
  slug: 'studio-fryzur',
  name: 'Studio Fryzur',
  city: 'Warszawa',
  street: 'Kwiatowa 1',
  logoVersion: null,
  category: { id: 'c1', name: 'Fryzjer', slug: 'fryzjer' },
  avgRating: 4.5,
  reviewCount: 12,
  isAvailable: true,
  ...overrides,
});

const MOCK = [
  favorite(),
  favorite({
    id: 'biz2',
    slug: 'salon-kosmetyczny',
    name: 'Salon Kosmetyczny',
    city: 'Kraków',
    category: { id: 'c2', name: 'Kosmetyczka', slug: 'kosmetyczka' },
    avgRating: null,
    reviewCount: 0,
  }),
];

async function setup(response: unknown = MOCK, status?: number) {
  localStorage.clear();
  setLocale('pl');
  signInAs({ role: 'CLIENT' });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'client/favorites', component: Favorites },
        { path: 'search', component: Blank },
        { path: ':slug', component: Blank },
      ]),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });

  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl('/client/favorites', Favorites);
  const http = TestBed.inject(HttpTestingController);
  const req = http.expectOne('/api/favorites');
  if (status) {
    req.flush(null, { status, statusText: 'Server Error' });
  } else {
    req.flush(response);
  }
  await settle(harness.fixture);
  harness.detectChanges();

  const el = () => harness.fixture.nativeElement as HTMLElement;
  const text = () => el().textContent ?? '';
  const cards = () => [...el().querySelectorAll('li')];
  /** Tylko anchory z href — pozycja niedostępna renderuje `<a>` bez linku. */
  const links = () => [...el().querySelectorAll<HTMLAnchorElement>('li a[href]')];
  const hearts = () =>
    [...el().querySelectorAll<HTMLButtonElement>('li button')];

  const click = async (button: HTMLButtonElement) => {
    button.click();
    await settle(harness.fixture);
    harness.detectChanges();
  };

  return { harness, http, el, text, cards, links, hearts, click };
}

describe('Favorites', () => {
  afterEach(() => {
    verifyIgnoringProfile(TestBed.inject(HttpTestingController));
  });

  it('pokazuje ulubione w kolejności z API, z kategorią, miastem i oceną', async () => {
    const ctx = await setup();

    expect(ctx.cards()).toHaveLength(2);
    expect(ctx.cards()[0].textContent).toContain('Studio Fryzur');
    expect(ctx.cards()[0].textContent).toContain('Fryzjer');
    expect(ctx.cards()[0].textContent).toContain('Warszawa');
    expect(ctx.cards()[0].textContent).toContain('4,5');
    expect(ctx.cards()[1].textContent).toContain('Salon Kosmetyczny');
  });

  it('firma bez ocen nie dostaje atrapy „0,0"', async () => {
    const ctx = await setup();

    expect(ctx.cards()[1].textContent).not.toContain('0,0');
    expect(ctx.cards()[1].querySelector('[role="img"]')).toBeNull();
  });

  it('karta prowadzi na profil firmy', async () => {
    const ctx = await setup();

    expect(ctx.links().map((a) => a.getAttribute('href'))).toEqual([
      '/studio-fryzur',
      '/salon-kosmetyczny',
    ]);
  });

  it('serce usuwa z ulubionych i pozycja znika bez ponownego pobrania listy', async () => {
    const ctx = await setup();

    await ctx.click(ctx.hearts()[0]);
    ctx.http.expectOne({ method: 'DELETE', url: '/api/businesses/biz1/favorite' }).flush(null, {
      status: 204,
      statusText: 'No Content',
    });
    await settle(ctx.harness.fixture);
    ctx.harness.detectChanges();

    expect(ctx.cards()).toHaveLength(1);
    expect(ctx.text()).not.toContain('Studio Fryzur');
    expect(ctx.text()).toContain('Salon Kosmetyczny');
    ctx.http.expectNone('/api/favorites');
  });

  it('nieudane usunięcie zostawia pozycję na liście i mówi o błędzie', async () => {
    const ctx = await setup();

    await ctx.click(ctx.hearts()[0]);
    ctx.http
      .expectOne({ method: 'DELETE', url: '/api/businesses/biz1/favorite' })
      .flush(null, { status: 500, statusText: 'Server Error' });
    await settle(ctx.harness.fixture);
    ctx.harness.detectChanges();

    expect(ctx.cards()).toHaveLength(2);
    expect(ctx.el().querySelector('[role="alert"]')?.textContent).toContain(
      'błąd serwera',
    );
  });

  it('firma niedostępna zostaje wyszarzona, bez linku, ale wciąż da się ją usunąć', async () => {
    const ctx = await setup([favorite({ isAvailable: false })]);

    expect(ctx.text()).toContain('Ta firma jest obecnie niedostępna');
    expect(ctx.links()).toHaveLength(0);
    // wyszarzenie idzie tłem, nie przezroczystością — inaczej komunikat traci kontrast
    expect(ctx.cards()[0].className).toContain('bg-stone-100');
    expect(ctx.text()).toContain('Studio Fryzur');

    await ctx.click(ctx.hearts()[0]);
    ctx.http.expectOne({ method: 'DELETE', url: '/api/businesses/biz1/favorite' }).flush(null, {
      status: 204,
      statusText: 'No Content',
    });
    await settle(ctx.harness.fixture);
    ctx.harness.detectChanges();

    expect(ctx.cards()).toHaveLength(0);
  });

  it('pusta lista pokazuje stan pusty z linkiem do wyszukiwarki', async () => {
    const ctx = await setup([]);

    expect(ctx.text()).toContain('Nie masz jeszcze ulubionych firm');
    const link = ctx.el().querySelector<HTMLAnchorElement>('a[href="/search"]');
    expect(link).not.toBeNull();
  });

  it('usunięcie ostatniej pozycji pokazuje stan pusty', async () => {
    const ctx = await setup([favorite()]);

    await ctx.click(ctx.hearts()[0]);
    ctx.http.expectOne({ method: 'DELETE', url: '/api/businesses/biz1/favorite' }).flush(null, {
      status: 204,
      statusText: 'No Content',
    });
    await settle(ctx.harness.fixture);
    ctx.harness.detectChanges();

    expect(ctx.text()).toContain('Nie masz jeszcze ulubionych firm');
  });

  it('nieudane pobranie listy to stan błędu, nie pustka — retry powtarza żądanie', async () => {
    const ctx = await setup(null, 500);

    expect(ctx.text()).not.toContain('Nie masz jeszcze ulubionych firm');
    const retry = [...ctx.el().querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.includes('Spróbuj ponownie'),
    );
    expect(retry).toBeDefined();

    await ctx.click(retry as HTMLButtonElement);
    ctx.http.expectOne('/api/favorites').flush(MOCK);
    await settle(ctx.harness.fixture);
    ctx.harness.detectChanges();

    expect(ctx.text()).toContain('Studio Fryzur');
  });
});
