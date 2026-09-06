import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { AuthStore, type UserRole } from '../../core/auth/auth-store';
import { profileResponse } from '../../core/auth/auth-testing';
import AccountItems from './account-items';

const fakeJwt = (payload: object) =>
  `header.${btoa(JSON.stringify(payload))}.signature`;

/** Profil, który `AuthStore` pobiera po wejściu na stronę (#161); `null` = pobranie padło. */
async function setup(role: UserRole, name: { firstName: string; lastName: string } | null = null) {
  localStorage.clear();
  localStorage.setItem(
    'bookit.accessToken',
    fakeJwt({ sub: '1', email: 'anna.kowalska@firma.pl', role }),
  );
  await TestBed.configureTestingModule({
    imports: [AccountItems],
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(AccountItems);
  fixture.detectChanges();

  const req = TestBed.inject(HttpTestingController).expectOne('/api/users/me');
  if (name) {
    req.flush(profileResponse({ ...name, role }));
  } else {
    req.flush(null, { status: 500, statusText: 'Server Error' });
  }
  await Promise.resolve();
  fixture.detectChanges();

  const el = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    el,
    logoutButton: () =>
      Array.from(el.querySelectorAll('button')).find((b) =>
        (b.textContent ?? '').includes('Wyloguj'),
      ),
  };
}

describe('AccountItems', () => {
  it('pokazuje e-mail zalogowanego i skrót do strony domowej jego roli', async () => {
    const { el } = await setup('OWNER');

    expect(el.textContent).toContain('anna.kowalska@firma.pl');
    const home = el.querySelector('a');
    expect(home?.getAttribute('href')).toBe('/business');
    expect(home?.textContent).toContain('Panel firmy');
  });

  it('dla klienta skrót prowadzi na stronę główną', async () => {
    const { el } = await setup('CLIENT');

    const home = el.querySelector('a');
    expect(home?.getAttribute('href')).toBe('/');
    expect(home?.textContent).toContain('Strona główna');
  });

  it('pokazuje imię i nazwisko nad adresem, gdy profil jest w stanie', async () => {
    const { el } = await setup('CLIENT', { firstName: 'Anna', lastName: 'Kowalska' });

    expect(el.textContent).toContain('Anna Kowalska');
    expect(el.textContent).toContain('anna.kowalska@firma.pl');
  });

  it('bez profilu zostaje sam adres — nieudane pobranie nie psuje menu', async () => {
    const { el } = await setup('CLIENT');

    expect(el.textContent).toContain('anna.kowalska@firma.pl');
    expect(el.textContent).not.toContain('Anna Kowalska');
  });

  it('prowadzi do ustawień konta — dla każdej roli, nie tylko klienta', async () => {
    for (const role of ['CLIENT', 'OWNER', 'EMPLOYEE', 'ADMIN'] as const) {
      TestBed.resetTestingModule();
      const { el } = await setup(role);

      const account = Array.from(el.querySelectorAll('a')).find(
        (a) => a.getAttribute('href') === '/account',
      );
      expect(account?.textContent).toContain('Ustawienia konta');
    }
  });

  it('grupa jest opisana dla czytnika ekranu', async () => {
    const { el } = await setup('CLIENT');

    expect(el.getAttribute('role')).toBe('group');
    expect(el.getAttribute('aria-label')).toBe('Konto');
  });

  it('„Wyloguj" woła AuthStore.logout()', async () => {
    const { logoutButton } = await setup('CLIENT');
    // stub, żeby test nie odpalał prawdziwej nawigacji na /login
    const logout = vi.spyOn(TestBed.inject(AuthStore), 'logout').mockReturnValue(undefined);

    logoutButton()?.click();

    expect(logout).toHaveBeenCalledOnce();
  });
});
