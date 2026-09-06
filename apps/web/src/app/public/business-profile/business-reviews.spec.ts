import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { settle } from '../testing-helpers';
import BusinessReviews from './business-reviews';

const review = (
  id: string,
  rating: number,
  comment: string | null,
  author: { id?: string; name?: string; avatarVersion?: string | null } = {},
) => ({
  id,
  rating,
  comment,
  createdAt: '2026-08-01T10:00:00.000Z',
  // autor jedzie obiektem (#165): podpis plus to, czym adresujemy jego zdjęcie profilowe
  author: { id: 'u1', name: 'Anna K.', avatarVersion: null, ...author },
});

/** Rozkład opisuje całą firmę, nie stronę — backend liczy go bez skip/take (#111). */
const distribution = (counts: Partial<Record<1 | 2 | 3 | 4 | 5, number>> = {}) => ({
  1: 0,
  2: 0,
  3: 0,
  4: 0,
  5: 0,
  ...counts,
});

const RESPONSE = {
  items: [review('r1', 5, 'Bardzo miła obsługa'), review('r2', 4, null)],
  total: 2,
  page: 1,
  limit: 20,
  ratingDistribution: distribution({ 4: 1, 5: 1 }),
};

/** URL z query stringiem — expectOne(url) porównuje też parametry, więc łapiemy predykatem. */
const reviewsUrl = (page: number) => `/api/businesses/test-slug/reviews?page=${page}`;

async function setup(response: unknown = RESPONSE) {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });

  const fixture = TestBed.createComponent(BusinessReviews);
  fixture.componentRef.setInput('slug', 'test-slug');
  fixture.detectChanges();

  const http = TestBed.inject(HttpTestingController);
  http.expectOne(reviewsUrl(1)).flush(response);
  await settle(fixture);
  fixture.detectChanges();

  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => (el().textContent ?? '').replace(/\s+/g, ' ').trim();
  const buttonWith = (label: string) =>
    [...el().querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      (b.textContent ?? '').includes(label),
    );
  const click = async (button: HTMLButtonElement | undefined) => {
    button?.click();
    await settle(fixture);
    fixture.detectChanges();
  };

  return { fixture, http, el, text, buttonWith, click };
}

describe('BusinessReviews', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('pokazuje opinie z autorem, oceną, datą i komentarzem', async () => {
    const ctx = await setup();

    expect(ctx.text()).toContain('Recenzje');
    expect(ctx.text()).toContain('Anna K.');
    expect(ctx.text()).toContain('Bardzo miła obsługa');
    expect(ctx.text()).toContain('1.08.2026');
    // scope na listę opinii — nad nią stoi histogram, który ma własne pięć <li>
    expect(ctx.el().querySelectorAll('ul.divide-y > li')).toHaveLength(2);
    // ocena idzie do czytnika ekranu jako jedna etykieta, bez powtarzania liczby przy gwiazdkach
    expect(ctx.el().querySelector('[aria-label="Ocena 5 na 5"]')).not.toBeNull();
  });

  it('autor ze zdjęciem profilowym dostaje je przy swojej opinii, z wersją w adresie', async () => {
    const ctx = await setup({
      ...RESPONSE,
      items: [review('r1', 5, 'Bardzo miła obsługa', { id: 'u7', avatarVersion: 'abc123' })],
      total: 1,
    });

    const photo = ctx.el().querySelector('ul.divide-y img');
    expect(photo?.getAttribute('src')).toBe('/api/users/u7/avatar?v=abc123');
    // podpis stoi obok, więc obraz nie ma czytnikowi ekranu nic do dodania
    expect(photo?.getAttribute('alt')).toBe('');
    expect(ctx.text()).toContain('Anna K.');
  });

  it('autor bez zdjęcia dostaje monogram z inicjałów, a nie puste miejsce', async () => {
    const ctx = await setup({
      ...RESPONSE,
      items: [review('r1', 5, 'Bardzo miła obsługa')],
      total: 1,
    });

    const tile = ctx.el().querySelector('ul.divide-y app-user-photo')!;
    expect(tile.querySelector('img')).toBeNull();
    expect(tile.textContent?.trim()).toBe('AK');
  });

  it('każda opinia dostaje kafelek autora, bez dodatkowego żądania przez ApiClient', async () => {
    const ctx = await setup();

    // zdjęcie to zwykły <img src> pod publiczny endpoint, więc nie leci przez ApiClient
    // i nie dokłada nagłówka z tokenem — afterEach z http.verify() pilnuje, że poza listą
    // opinii komponent nie wysłał żadnego żądania
    expect(ctx.el().querySelectorAll('ul.divide-y app-user-photo')).toHaveLength(2);
  });

  it('nowa wersja zdjęcia autora podmienia obrazek przy jego opinii', async () => {
    const ctx = await setup({
      ...RESPONSE,
      items: [review('r1', 5, 'Bardzo miła obsługa', { id: 'u7', avatarVersion: 'abc123' })],
      total: 1,
    });

    // ten sam autor, inny profil firmy: po wgraniu nowego zdjęcia lista niesie nową wersję,
    // a że jedzie ona w query stringu, `Cache-Control: immutable` nie przykleja starego obrazu
    ctx.fixture.componentRef.setInput('slug', 'test-slug-2');
    ctx.fixture.detectChanges();
    ctx.http.expectOne('/api/businesses/test-slug-2/reviews?page=1').flush({
      ...RESPONSE,
      items: [review('r1', 5, 'Bardzo miła obsługa', { id: 'u7', avatarVersion: 'def456' })],
      total: 1,
    });
    await settle(ctx.fixture);
    ctx.fixture.detectChanges();

    expect(ctx.el().querySelector('ul.divide-y img')?.getAttribute('src')).toBe(
      '/api/users/u7/avatar?v=def456',
    );
  });

  it('pokazuje rozkład ocen z agregatu nad listą opinii', async () => {
    const ctx = await setup();

    const histogram = ctx.el().querySelector('app-rating-distribution');
    expect(histogram).not.toBeNull();
    // nad listą opinii, nie pod nią — pozycja w DOM decyduje o kolejności czytania
    const list = ctx.el().querySelector('ul.divide-y')!;
    expect(
      histogram!.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(ctx.text()).toContain('5 ★ 1 · 50%');
  });

  it('brak opinii: komunikat zamiast pustej listy, bez paska stron i bez histogramu', async () => {
    const ctx = await setup({ items: [], total: 0, page: 1, limit: 20, ratingDistribution: distribution() });

    expect(ctx.text()).toContain('Ta firma nie ma jeszcze opinii');
    expect(ctx.el().querySelector('nav')).toBeNull();
    expect(ctx.el().querySelector('app-rating-distribution')).toBeNull();
  });

  it('jedna strona opinii nie dostaje paska stron', async () => {
    const ctx = await setup();

    expect(ctx.el().querySelector('nav')).toBeNull();
  });

  it('przy wielu stronach klik „Następna" pobiera kolejną stronę i podmienia listę', async () => {
    const ctx = await setup({ ...RESPONSE, total: 45, ratingDistribution: distribution({ 5: 30, 4: 15 }) });

    expect(ctx.text()).toContain('1–20 z 45 opinii');

    await ctx.click(ctx.buttonWith('Następna'));

    ctx.http.expectOne(reviewsUrl(2)).flush({
      items: [review('r3', 3, 'Bywało lepiej')],
      total: 45,
      page: 2,
      limit: 20,
      ratingDistribution: distribution({ 5: 30, 4: 15 }),
    });
    await settle(ctx.fixture);
    ctx.fixture.detectChanges();

    expect(ctx.text()).toContain('Bywało lepiej');
    expect(ctx.text()).not.toContain('Bardzo miła obsługa');
    expect(ctx.text()).toContain('21–40 z 45 opinii');
  });

  it('spóźniona odpowiedź poprzedniej firmy nie nadpisuje nowszej', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(BusinessReviews);
    fixture.componentRef.setInput('slug', 'test-slug');
    fixture.detectChanges();

    const http = TestBed.inject(HttpTestingController);
    const first = http.expectOne(reviewsUrl(1));

    // zmiana firmy z żądaniem w locie — oba wiszą naraz
    fixture.componentRef.setInput('slug', 'inna-firma');
    fixture.detectChanges();
    const second = http.expectOne('/api/businesses/inna-firma/reviews?page=1');

    // nowsza firma wraca pierwsza, spóźnialska po niej
    second.flush({
      items: [review('r9', 5, 'Opinia nowej firmy')],
      total: 1,
      page: 1,
      limit: 20,
      ratingDistribution: distribution({ 5: 1 }),
    });
    await settle(fixture);
    first.flush({
      items: [review('r1', 1, 'Opinia poprzedniej firmy')],
      total: 1,
      page: 1,
      limit: 20,
      ratingDistribution: distribution({ 1: 1 }),
    });
    await settle(fixture);
    fixture.detectChanges();

    const text = ((fixture.nativeElement as HTMLElement).textContent ?? '').trim();
    expect(text).toContain('Opinia nowej firmy');
    expect(text).not.toContain('Opinia poprzedniej firmy');
  });

  it('błąd pobrania: komunikat i ponowna próba zamiast „brak opinii"', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(BusinessReviews);
    fixture.componentRef.setInput('slug', 'test-slug');
    fixture.detectChanges();

    const http = TestBed.inject(HttpTestingController);
    http.expectOne(reviewsUrl(1)).flush(
      { statusCode: 404, code: 'NOT_FOUND', message: 'Nie znaleziono firmy' },
      { status: 404, statusText: 'Not Found' },
    );
    await settle(fixture);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Nie znaleziono firmy');
    expect(el.textContent).not.toContain('Ta firma nie ma jeszcze opinii');

    const retry = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('Spróbuj ponownie'),
    );
    retry?.click();
    await settle(fixture);

    http.expectOne(reviewsUrl(1)).flush(RESPONSE);
    await settle(fixture);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Bardzo miła obsługa',
    );
  });

  it('zmiana firmy resetuje stronę i pobiera opinie nowej firmy', async () => {
    const ctx = await setup({ ...RESPONSE, total: 45, ratingDistribution: distribution({ 5: 30, 4: 15 }) });

    await ctx.click(ctx.buttonWith('Następna'));
    ctx.http.expectOne(reviewsUrl(2)).flush({ ...RESPONSE, total: 45, page: 2 });
    await settle(ctx.fixture);
    ctx.fixture.detectChanges();

    // Angular reużywa instancję między dwoma profilami — bez resetu nowa firma
    // otworzyłaby się na stronie 2
    ctx.fixture.componentRef.setInput('slug', 'inna-firma');
    ctx.fixture.detectChanges();
    await settle(ctx.fixture);

    ctx.http
      .expectOne('/api/businesses/inna-firma/reviews?page=1')
      .flush({ items: [], total: 0, page: 1, limit: 20, ratingDistribution: distribution() });
    await settle(ctx.fixture);
    ctx.fixture.detectChanges();

    expect(ctx.text()).toContain('Ta firma nie ma jeszcze opinii');
  });
});
