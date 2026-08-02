import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { settle } from '../testing-helpers';
import BusinessReviews from './business-reviews';

const review = (id: string, rating: number, comment: string | null) => ({
  id,
  rating,
  comment,
  createdAt: '2026-08-01T10:00:00.000Z',
  author: 'Anna K.',
});

const RESPONSE = {
  items: [review('r1', 5, 'Bardzo miła obsługa'), review('r2', 4, null)],
  total: 2,
  page: 1,
  limit: 20,
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
    expect(ctx.el().querySelectorAll('li')).toHaveLength(2);
    // ocena idzie do czytnika ekranu jako jedna etykieta, bez powtarzania liczby przy gwiazdkach
    expect(ctx.el().querySelector('[aria-label="Ocena 5 na 5"]')).not.toBeNull();
  });

  it('brak opinii: komunikat zamiast pustej listy i bez paska stron', async () => {
    const ctx = await setup({ items: [], total: 0, page: 1, limit: 20 });

    expect(ctx.text()).toContain('Ta firma nie ma jeszcze opinii');
    expect(ctx.el().querySelector('nav')).toBeNull();
  });

  it('jedna strona opinii nie dostaje paska stron', async () => {
    const ctx = await setup();

    expect(ctx.el().querySelector('nav')).toBeNull();
  });

  it('przy wielu stronach klik „Następna" pobiera kolejną stronę i podmienia listę', async () => {
    const ctx = await setup({ ...RESPONSE, total: 45 });

    expect(ctx.text()).toContain('1–20 z 45 opinii');

    await ctx.click(ctx.buttonWith('Następna'));

    ctx.http.expectOne(reviewsUrl(2)).flush({
      items: [review('r3', 3, 'Bywało lepiej')],
      total: 45,
      page: 2,
      limit: 20,
    });
    await settle(ctx.fixture);
    ctx.fixture.detectChanges();

    expect(ctx.text()).toContain('Bywało lepiej');
    expect(ctx.text()).not.toContain('Bardzo miła obsługa');
    expect(ctx.text()).toContain('21–40 z 45 opinii');
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
    const ctx = await setup({ ...RESPONSE, total: 45 });

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
      .flush({ items: [], total: 0, page: 1, limit: 20 });
    await settle(ctx.fixture);
    ctx.fixture.detectChanges();

    expect(ctx.text()).toContain('Ta firma nie ma jeszcze opinii');
  });
});
