import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Business } from '../settings/business-response';
import { businessResponse } from '../settings/testing-helpers';
import SettingsTile from './settings-tile';

const setup = () => {
  const fixture = TestBed.createComponent(SettingsTile);
  const http = TestBed.inject(HttpTestingController);
  fixture.detectChanges(); // konstruktor odpala GET
  return { fixture, http, el: fixture.nativeElement as HTMLElement };
};

const businessRequest = (http: HttpTestingController) =>
  http.expectOne('/api/businesses/mine');

const text = (el: HTMLElement) => (el.textContent ?? '').replace(/\s/g, ' ');

async function respond(
  fixture: ComponentFixture<SettingsTile>,
  http: HttpTestingController,
  business: Partial<Business> = {},
) {
  businessRequest(http).flush(businessResponse(business));
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('SettingsTile', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsTile],
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

  it('pokazuje nazwę, adres w jednej linii, telefon i politykę odwołań', async () => {
    const { fixture, http, el } = setup();
    await respond(fixture, http);

    const content = text(el);
    expect(content).toContain('Salon Ola');
    expect(content).toContain('Kwiatowa 1, 00-001 Warszawa');
    expect(content).toContain('+48 500 600 700');
    expect(content).toContain('24');
  });

  it('bez kodu pocztowego adres nie gubi przecinka ani nie zostaje z pustym miejscem', async () => {
    const { fixture, http, el } = setup();
    await respond(fixture, http, { postalCode: null });

    expect(text(el)).toContain('Kwiatowa 1, Warszawa');
  });

  it('zero godzin to odwołanie do ostatniej chwili, nie „do 0 h przed"', async () => {
    const { fixture, http, el } = setup();
    await respond(fixture, http, { cancellationHours: 0 });

    const content = text(el);
    expect(content).toContain('ostatniej chwili');
    expect(content).not.toContain('0 h');
  });

  it('brak telefonu zamienia go w podpowiedź, a nie w pustą linię', async () => {
    const { fixture, http, el } = setup();
    await respond(fixture, http, { phone: null });

    expect(text(el)).toContain('Uzupełnij telefon');
  });

  it('brak opisu firmy też daje podpowiedź, choć opisu kafelek nie pokazuje', async () => {
    const { fixture, http, el } = setup();
    await respond(fixture, http, { description: null });

    expect(text(el)).toContain('Uzupełnij opis firmy');
  });

  it('brak telefonu i opisu to jedna podpowiedź, nie dwie', async () => {
    const { fixture, http, el } = setup();
    await respond(fixture, http, { phone: null, description: '' });

    const content = text(el);
    expect(content).toContain('Uzupełnij telefon i opis firmy');
    expect(content.match(/Uzupełnij/g)).toHaveLength(1);
  });

  it('opis z samych spacji to brak opisu, nie opis', async () => {
    const { fixture, http, el } = setup();
    await respond(fixture, http, { description: '   ' });

    expect(text(el)).toContain('Uzupełnij opis firmy');
  });

  it('komplet danych nie generuje podpowiedzi', async () => {
    const { fixture, http, el } = setup();
    await respond(fixture, http);

    expect(text(el)).not.toContain('Uzupełnij');
  });

  it('do czasu odpowiedzi pokazuje stan ładowania', () => {
    const { el, http } = setup();

    expect(el.querySelector('app-loading-state')).not.toBeNull();

    businessRequest(http).flush(businessResponse());
  });

  it('błąd pokazuje komunikat i ponowienie, które pobiera dane jeszcze raz', async () => {
    const { fixture, http, el } = setup();
    businessRequest(http).flush(
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

    await respond(fixture, http);
    expect(el.querySelector('app-error-state')).toBeNull();
    expect(text(el)).toContain('Salon Ola');
  });

  it('prowadzi na /business/settings jednym linkiem, bez akcji w treści', async () => {
    const { fixture, http, el } = setup();
    await respond(fixture, http);

    expect(
      [...el.querySelectorAll('a')].map((a) => a.getAttribute('href')),
    ).toEqual(['/business/settings']);
    expect(el.querySelectorAll('button')).toHaveLength(0);
  });
});
