import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthStore } from './auth-store';

const fakeJwt = (payload: object) =>
  `header.${btoa(JSON.stringify(payload))}.signature`;

describe('AuthStore', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
  });

  it('wczytuje tokeny z localStorage — sesja przeżywa odświeżenie strony', () => {
    localStorage.setItem(
      'bookit.accessToken',
      fakeJwt({ sub: '1', email: 'a@b.pl', role: 'OWNER' }),
    );
    const store = TestBed.inject(AuthStore);
    expect(store.isLoggedIn()).toBe(true);
    expect(store.user()?.role).toBe('OWNER');
    expect(store.user()?.email).toBe('a@b.pl');
  });

  it('bez tokenów jest wylogowany; uszkodzony token nie wywala dekodera', () => {
    localStorage.setItem('bookit.accessToken', 'nie-jwt');
    const store = TestBed.inject(AuthStore);
    expect(store.isLoggedIn()).toBe(false);
    expect(store.user()).toBeNull();
  });

  it('login wysyła POST /auth/login, zapisuje tokeny i przekierowuje na stronę roli', async () => {
    const store = TestBed.inject(AuthStore);
    const http = TestBed.inject(HttpTestingController);
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);

    const pending = store.login({ email: 'a@b.pl', password: 'tajnehaslo' });

    const req = http.expectOne('/api/auth/login');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'a@b.pl', password: 'tajnehaslo' });
    req.flush({
      accessToken: fakeJwt({ sub: '1', email: 'a@b.pl', role: 'CLIENT' }),
      refreshToken: 'refresh',
    });
    await pending;

    expect(store.isLoggedIn()).toBe(true);
    expect(localStorage.getItem('bookit.refreshToken')).toBe('refresh');
    expect(navigate).toHaveBeenCalledWith('/client');
  });

  it('register wysyła POST /auth/register i loguje automatycznie', async () => {
    const store = TestBed.inject(AuthStore);
    const http = TestBed.inject(HttpTestingController);
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);

    const dto = {
      email: 'a@b.pl',
      password: 'tajnehaslo',
      firstName: 'Jan',
      lastName: 'Kowalski',
    };
    const pending = store.register(dto);

    const req = http.expectOne('/api/auth/register');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(dto);
    req.flush({
      accessToken: fakeJwt({ sub: '1', email: 'a@b.pl', role: 'CLIENT' }),
      refreshToken: 'refresh',
    });
    await pending;

    expect(store.isLoggedIn()).toBe(true);
    expect(store.user()?.role).toBe('CLIENT');
    expect(navigate).toHaveBeenCalledWith('/client');
  });

  it('login z returnUrl wraca na wskazany adres zamiast na stronę roli', async () => {
    const store = TestBed.inject(AuthStore);
    const http = TestBed.inject(HttpTestingController);
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);

    const pending = store.login(
      { email: 'a@b.pl', password: 'tajnehaslo' },
      '/studio/rezerwacja?serviceId=s1',
    );
    http.expectOne('/api/auth/login').flush({
      accessToken: fakeJwt({ sub: '1', email: 'a@b.pl', role: 'CLIENT' }),
      refreshToken: 'refresh',
    });
    await pending;

    expect(navigate).toHaveBeenCalledWith('/studio/rezerwacja?serviceId=s1');
  });

  it.each(['//evil.com', 'https://evil.com', '/\\evil.com', ''])(
    'odrzuca returnUrl prowadzący poza aplikację: %s',
    async (returnUrl) => {
      const store = TestBed.inject(AuthStore);
      const http = TestBed.inject(HttpTestingController);
      const navigate = vi
        .spyOn(TestBed.inject(Router), 'navigateByUrl')
        .mockResolvedValue(true);

      const pending = store.login(
        { email: 'a@b.pl', password: 'tajnehaslo' },
        returnUrl,
      );
      http.expectOne('/api/auth/login').flush({
        accessToken: fakeJwt({ sub: '1', email: 'a@b.pl', role: 'CLIENT' }),
        refreshToken: 'refresh',
      });
      await pending;

      expect(navigate).toHaveBeenCalledWith('/client');
    },
  );

  it('padnięta sesja (nieudany refresh) zachowuje bieżący adres jako returnUrl', async () => {
    localStorage.setItem('bookit.refreshToken', 'r');
    const store = TestBed.inject(AuthStore);
    const http = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'url', 'get').mockReturnValue(
      '/studio/rezerwacja?serviceId=s1',
    );
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const pending = store.refresh().catch(() => undefined);
    http
      .expectOne('/api/auth/refresh')
      .flush(null, { status: 401, statusText: 'Unauthorized' });
    await pending;

    expect(store.isLoggedIn()).toBe(false);
    expect(navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/studio/rezerwacja?serviceId=s1' },
    });
  });

  it('logout czyści tokeny i przekierowuje na /login', () => {
    localStorage.setItem(
      'bookit.accessToken',
      fakeJwt({ sub: '1', email: 'a@b.pl', role: 'CLIENT' }),
    );
    localStorage.setItem('bookit.refreshToken', 'r');
    const store = TestBed.inject(AuthStore);
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);

    store.logout();

    expect(store.isLoggedIn()).toBe(false);
    expect(localStorage.getItem('bookit.accessToken')).toBeNull();
    expect(localStorage.getItem('bookit.refreshToken')).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/login']);
  });
});
