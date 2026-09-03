import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
  UrlTree,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { AuthStore, homeFor } from './auth-store';
import {
  authGuard,
  guestGuard,
  passwordChangeGuard,
  roleGuard,
} from './auth.guard';

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

describe('roleGuard', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient()],
    });
  });

  const runRoleGuard = (url: string) =>
    TestBed.runInInjectionContext(() =>
      roleGuard('ADMIN')(snapshotWith(), { url } as RouterStateSnapshot),
    );

  it('wpuszcza admina do panelu', () => {
    localStorage.setItem(
      'bookit.accessToken',
      fakeJwt({ sub: '1', email: 'admin@bookit.pl', role: 'ADMIN' }),
    );
    expect(runRoleGuard('/admin/businesses')).toBe(true);
  });

  it('zalogowanego z inną rolą odsyła na /login z returnUrl', () => {
    localStorage.setItem(
      'bookit.accessToken',
      fakeJwt({ sub: '1', email: 'a@b.pl', role: 'CLIENT' }),
    );
    const result = runRoleGuard('/admin/businesses');
    expect(result).toBeInstanceOf(UrlTree);
    expect(result.toString()).toBe('/login?returnUrl=%2Fadmin%2Fbusinesses');
  });

  it('niezalogowanego odsyła na /login', () => {
    expect(runRoleGuard('/admin/users').toString()).toBe(
      '/login?returnUrl=%2Fadmin%2Fusers',
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

describe('passwordChangeGuard', () => {
  const runGuard = (url: string) =>
    TestBed.runInInjectionContext(() =>
      passwordChangeGuard(snapshotWith(), { url } as RouterStateSnapshot),
    );

  const login = (mustChangePassword?: boolean) =>
    localStorage.setItem(
      'bookit.accessToken',
      fakeJwt({ sub: '1', email: 'admin@bookit.pl', role: 'ADMIN', mustChangePassword }),
    );

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient()],
    });
  });

  it('wpuszcza konto bez flagi', () => {
    login(false);
    expect(runGuard('/admin')).toBe(true);
  });

  it('wpuszcza niezalogowanego — nie ma czego zmieniać', () => {
    expect(runGuard('/login')).toBe(true);
  });

  it('konto spod flagi odbija z dowolnej trasy na zmianę hasła', () => {
    login(true);
    for (const url of ['/admin', '/admin/users', '/client', '/']) {
      const result = runGuard(url);
      expect(result).toBeInstanceOf(UrlTree);
      expect(result.toString()).toBe('/change-password');
    }
  });

  it('przepuszcza sam ekran zmiany hasła — inaczej redirect byłby pętlą', () => {
    login(true);
    expect(runGuard('/change-password')).toBe(true);
  });

  it('odbija też wtedy, gdy flagę zgłosiło 403, a nie token', () => {
    login(false);
    const store = TestBed.inject(AuthStore);
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    store.requirePasswordChange();

    const result = runGuard('/admin');
    expect(result).toBeInstanceOf(UrlTree);
    expect(result.toString()).toBe('/change-password');
  });
});
