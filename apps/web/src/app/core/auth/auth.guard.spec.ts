import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { homeFor } from './auth-store';
import { guestGuard } from './auth.guard';

const fakeJwt = (payload: object) =>
  `header.${btoa(JSON.stringify(payload))}.signature`;

const runGuestGuard = () =>
  TestBed.runInInjectionContext(() =>
    guestGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
  );

describe('guestGuard', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient()],
    });
  });

  it('wpuszcza niezalogowanego', () => {
    expect(runGuestGuard()).toBe(true);
  });

  it('zalogowanego klienta przekierowuje na /client', () => {
    localStorage.setItem(
      'bookit.accessToken',
      fakeJwt({ sub: '1', email: 'a@b.pl', role: 'CLIENT' }),
    );
    const result = runGuestGuard();
    expect(result).toBeInstanceOf(UrlTree);
    expect(result.toString()).toBe('/client');
  });

  it('wpuszcza na /login przy wygasłym tokenie — martwa sesja nie blokuje logowania', () => {
    localStorage.setItem(
      'bookit.accessToken',
      fakeJwt({
        sub: '1',
        email: 'a@b.pl',
        role: 'CLIENT',
        exp: Math.floor(Date.now() / 1000) - 60,
      }),
    );
    expect(runGuestGuard()).toBe(true);
  });
});

describe('homeFor', () => {
  it('mapuje rolę na stronę domową', () => {
    expect(homeFor('CLIENT')).toBe('/client');
    expect(homeFor('OWNER')).toBe('/business');
    expect(homeFor('EMPLOYEE')).toBe('/business');
    expect(homeFor('ADMIN')).toBe('/admin');
  });
});
