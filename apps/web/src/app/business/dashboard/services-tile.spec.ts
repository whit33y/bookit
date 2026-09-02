import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Service } from '../services/service-response';
import { serviceResponse } from '../services/testing-helpers';
import ServicesTile from './services-tile';

const setup = () => {
  const fixture = TestBed.createComponent(ServicesTile);
  const http = TestBed.inject(HttpTestingController);
  fixture.detectChanges(); // konstruktor odpala GET
  return { fixture, http, el: fixture.nativeElement as HTMLElement };
};

const servicesRequest = (http: HttpTestingController) =>
  http.expectOne('/api/businesses/mine/services');

/** Intl wstawia spację nierozdzielającą przed „zł" — normalizujemy, jak w stats-tile.spec.ts. */
const text = (el: HTMLElement) => (el.textContent ?? '').replace(/\s/g, ' ');

async function respond(
  fixture: ComponentFixture<ServicesTile>,
  http: HttpTestingController,
  services: Service[],
) {
  servicesRequest(http).flush(services);
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('ServicesTile', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ServicesTile],
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

  it('liczy tylko aktywne usługi — nieaktywne nie wchodzą ani do liczby, ani do próbki', async () => {
    const { fixture, http, el } = setup();
    await respond(fixture, http, [
      serviceResponse({ id: 'a', name: 'Strzyżenie' }),
      serviceResponse({ id: 'b', name: 'Broda' }),
      serviceResponse({ id: 'c', name: 'Koloryzacja', isActive: false }),
    ]);

    expect(text(el)).toContain('2 aktywne usługi');
    expect(text(el)).not.toContain('Koloryzacja');
  });

  it('próbka podaje cenę i czas trwania usługi', async () => {
    const { fixture, http, el } = setup();
    await respond(fixture, http, [
      serviceResponse({
        name: 'Strzyżenie',
        durationMin: 45,
        priceCents: 12000,
      }),
    ]);

    const item = text(el.querySelectorAll('li')[0]);
    expect(item).toContain('Strzyżenie');
    expect(item).toContain('45 min');
    expect(item).toContain('120 zł');
  });

  it('próbka ma najwyżej trzy pozycje, choć liczba obejmuje wszystkie aktywne', async () => {
    const { fixture, http, el } = setup();
    await respond(
      fixture,
      http,
      Array.from({ length: 6 }, (_, i) =>
        serviceResponse({ id: `s${i}`, name: `Usługa ${i}` }),
      ),
    );

    expect(el.querySelectorAll('li')).toHaveLength(3);
    expect(text(el)).toContain('6 aktywnych usług');
  });

  it('zero aktywnych usług to ostrzeżenie z CTA, nie „0" i nie pusta lista', async () => {
    const { fixture, http, el } = setup();
    await respond(fixture, http, [
      serviceResponse({ isActive: false, name: 'Koloryzacja' }),
    ]);

    const content = text(el);
    expect(content).toContain('Nie masz aktywnych usług');
    expect(content).toContain('Dodaj pierwszą usługę');
    expect(content).not.toContain('0 ');
    expect(el.querySelectorAll('li')).toHaveLength(0);
  });

  it('do czasu odpowiedzi pokazuje stan ładowania, nie zero usług', () => {
    const { el, http } = setup();

    expect(el.querySelector('app-loading-state')).not.toBeNull();
    expect(text(el)).not.toContain('usług');

    servicesRequest(http).flush([]);
  });

  it('błąd pokazuje komunikat i ponowienie, które pobiera dane jeszcze raz', async () => {
    const { fixture, http, el } = setup();
    servicesRequest(http).flush(
      {
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        message: 'Coś poszło nie tak',
      },
      { status: 500, statusText: 'Server Error' },
    );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('app-error-state')).not.toBeNull();
    expect(text(el)).toContain('Coś poszło nie tak');

    el.querySelector('app-error-state button')?.dispatchEvent(
      new Event('click'),
    );
    fixture.detectChanges();

    await respond(fixture, http, [serviceResponse()]);
    expect(el.querySelector('app-error-state')).toBeNull();
    expect(text(el)).toContain('1 aktywna usługa');
  });

  it('prowadzi na /business/services jednym linkiem, bez akcji w treści', async () => {
    const { fixture, http, el } = setup();
    await respond(fixture, http, [serviceResponse()]);

    expect(
      [...el.querySelectorAll('a')].map((a) => a.getAttribute('href')),
    ).toEqual(['/business/services']);
    expect(el.querySelectorAll('button')).toHaveLength(0);
  });
});
