import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  UrlTree,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { homeFor } from './auth-store';
import { authGuard, guestGuard } from './auth.guard';

const fakeJwt = (payload: object) =>
  `header.${btoa(JSON.stringify(payload))}.signature`;

const snapshotWith = (queryParams: Record<string, string> = {}) =>
  ({
    queryParamMap: convertToParamMap(queryParams),
  }) as unknown as ActivatedRouteSnapshot;

const runGuestGuard = (queryParams?: Record<string, string>) =>
  TestBed.runInInjectionContext(() =>
    guestGuard(snapshotWith(queryParams), {} as RouterStateSnapshot),
  );

const runAuthGuard = (url: string) =>
  TestBed.runInInjectionContext(() =>
    authGuard(snapshotWith(), { url } as RouterStateSnapshot),
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

  it('zalogowanego z returnUrl odsyła tam, nie na stronę roli', () => {
    localStorage.setItem(
      'bookit.accessToken',
      fakeJwt({ sub: '1', email: 'a@b.pl', role: 'CLIENT' }),
    );
    const result = runGuestGuard({ returnUrl: '/studio/rezerwacja?serviceId=s1' });
    expect(result.toString()).toBe('/studio/rezerwacja?serviceId=s1');
  });

  it('ignoruje returnUrl prowadzący poza aplikację', () => {
    localStorage.setItem(
      'bookit.accessToken',
      fakeJwt({ sub: '1', email: 'a@b.pl', role: 'CLIENT' }),
    );
    expect(runGuestGuard({ returnUrl: '//evil.com' }).toString()).toBe('/client');
  });
});

describe('authGuard', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient()],
    });
  });

  it('wpuszcza zalogowanego', () => {
    localStorage.setItem(
      'bookit.accessToken',
      fakeJwt({ sub: '1', email: 'a@b.pl', role: 'CLIENT' }),
    );
    expect(runAuthGuard('/client')).toBe(true);
  });

  it('niezalogowanego odsyła na /login z returnUrl na żądaną trasę', () => {
    const result = runAuthGuard('/studio/rezerwacja?serviceId=s1');
    expect(result).toBeInstanceOf(UrlTree);
    expect(result.toString()).toBe(
      '/login?returnUrl=%2Fstudio%2Frezerwacja%3FserviceId%3Ds1',
    );
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
