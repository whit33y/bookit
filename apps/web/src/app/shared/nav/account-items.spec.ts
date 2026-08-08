import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { AuthStore, type UserRole } from '../../core/auth/auth-store';
import AccountItems from './account-items';

const fakeJwt = (payload: object) =>
  `header.${btoa(JSON.stringify(payload))}.signature`;

async function setup(role: UserRole) {
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

  it('dla klienta skrót prowadzi do jego wizyt', async () => {
    const { el } = await setup('CLIENT');

    const home = el.querySelector('a');
    expect(home?.getAttribute('href')).toBe('/client');
    expect(home?.textContent).toContain('Moje wizyty');
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
