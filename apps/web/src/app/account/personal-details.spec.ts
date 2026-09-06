import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthStore } from '../core/auth/auth-store';
import { profileResponse } from '../core/auth/auth-testing';
import PersonalDetails from './personal-details';

/** Domknięcie łańcucha promise'ów żądania: makrozadanie na `then/catch/finally`, a potem
 *  stabilizacja widoku (wzór z `business/settings/settings.spec.ts`). */
const settle = async (fixture: { whenStable: () => Promise<unknown> }) => {
  await new Promise((r) => setTimeout(r, 0));
  await fixture.whenStable();
};

const fakeJwt = (payload: object) =>
  `header.${btoa(JSON.stringify(payload))}.signature`;

interface Model {
  firstName: string;
  lastName: string;
  phone: string;
}

/** Dostęp do protected sygnału modelu — wpisywanie w input przez Signal Forms w jsdom
 *  wymagałoby zdarzeń, a badamy zapis, nie wiązanie pola. */
interface TestAccess {
  model: WritableSignal<Model>;
}

describe('PersonalDetails', () => {
  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem(
      'bookit.accessToken',
      fakeJwt({ sub: '1', email: 'anna.kowalska@firma.pl', role: 'CLIENT' }),
    );
    await TestBed.configureTestingModule({
      imports: [PersonalDetails],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
  });

  /** `AuthStore` pobiera profil dla każdego zalogowanego (#161), a sekcja pobiera go dla
   *  siebie — oba żądania idą na ten sam adres, więc kwitujemy je razem. */
  async function setup(profile = profileResponse({ phone: '+48 500 600 700' })) {
    const fixture = TestBed.createComponent(PersonalDetails);
    fixture.detectChanges();

    const http = TestBed.inject(HttpTestingController);
    for (const req of http.match('/api/users/me')) {
      req.flush(profile);
    }
    await settle(fixture);

    const el = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      el,
      http,
      access: fixture.componentInstance as unknown as TestAccess,
      form: () => el.querySelector('form') as HTMLFormElement | null,
      submit: async () => {
        el.querySelector('form')?.dispatchEvent(
          new Event('submit', { cancelable: true }),
        );
        await settle(fixture);
      },
      value: (id: string) =>
        (el.querySelector(`#${id}`) as HTMLInputElement | null)?.value,
    };
  }

  it('startuje z aktualnymi wartościami profilu', async () => {
    const { value } = await setup();

    expect(value('firstName')).toBe('Anna');
    expect(value('lastName')).toBe('Kowalska');
    expect(value('phone')).toBe('+48 500 600 700');
  });

  it('zapisuje zmiany przez PATCH /users/me i odświeża profil w AuthStore', async () => {
    const { access, submit, http, fixture } = await setup();
    access.model.update((m) => ({ ...m, firstName: 'Ania' }));
    fixture.detectChanges();

    const done = submit();
    const req = http.expectOne(
      (r) => r.url === '/api/users/me' && r.method === 'PATCH',
    );
    expect(req.request.body).toEqual({
      firstName: 'Ania',
      lastName: 'Kowalska',
      phone: '+48 500 600 700',
    });
    req.flush(profileResponse({ firstName: 'Ania' }));
    await done;

    expect(TestBed.inject(AuthStore).fullName()).toBe('Ania Kowalska');
    expect(fixture.nativeElement.textContent).toContain('Zapisano dane osobowe');
  });

  it('kolejna edycja gasi potwierdzenie zapisu', async () => {
    const { access, submit, http, fixture } = await setup();

    const done = submit();
    http.expectOne((r) => r.method === 'PATCH').flush(profileResponse());
    await done;
    expect(fixture.nativeElement.textContent).toContain('Zapisano dane osobowe');

    access.model.update((m) => ({ ...m, lastName: 'Nowak' }));
    await settle(fixture);

    expect(fixture.nativeElement.textContent).not.toContain(
      'Zapisano dane osobowe',
    );
  });

  it('pomija pusty telefon — @Matches w DTO odrzuciłby pusty string', async () => {
    const { access, submit, http, fixture } = await setup(
      profileResponse({ phone: null }),
    );
    fixture.detectChanges();
    expect(access.model().phone).toBe('');

    const done = submit();
    const req = http.expectOne(
      (r) => r.url === '/api/users/me' && r.method === 'PATCH',
    );
    expect(req.request.body).toEqual({
      firstName: 'Anna',
      lastName: 'Kowalska',
    });
    req.flush(profileResponse({ phone: null }));
    await done;
  });

  it('nie wysyła nic, gdy imię jest puste', async () => {
    const { access, submit, http, fixture } = await setup();
    access.model.update((m) => ({ ...m, firstName: '' }));
    fixture.detectChanges();

    await submit();

    http.expectNone((r) => r.method === 'PATCH');
    expect(fixture.nativeElement.textContent).toContain('Imię jest wymagane');
  });

  it('błąd zapisu pokazuje komunikat i nie gubi wpisanych wartości', async () => {
    const { access, submit, http, value, fixture } = await setup();
    access.model.update((m) => ({ ...m, firstName: 'Ania' }));
    fixture.detectChanges();

    const done = submit();
    http
      .expectOne((r) => r.method === 'PATCH')
      .flush(null, { status: 500, statusText: 'Server Error' });
    await done;

    expect(
      fixture.nativeElement.querySelector('[role="alert"]')?.textContent,
    ).toBeTruthy();
    expect(value('firstName')).toBe('Ania');
  });

  it('nieudane pobranie profilu daje błąd z ponowieniem zamiast pustego formularza', async () => {
    const fixture = TestBed.createComponent(PersonalDetails);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    for (const req of http.match('/api/users/me')) {
      req.flush(null, { status: 500, statusText: 'Server Error' });
    }
    await settle(fixture);

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('form')).toBeNull();
    expect(el.textContent).toContain('Nie udało się wczytać danych konta');
  });
});
