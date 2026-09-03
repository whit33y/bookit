import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthStore } from './auth-store';
import { authInterceptor } from './auth.interceptor';

const fakeJwt = (payload: object) =>
  `header.${btoa(JSON.stringify(payload))}.signature`;

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve));

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let store: AuthStore;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
      'bookit.accessToken',
      fakeJwt({ sub: '1', email: 'a@b.pl', role: 'CLIENT' }),
    );
    localStorage.setItem('bookit.refreshToken', 'stary-refresh');

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    store = TestBed.inject(AuthStore);
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });

  afterEach(() => httpMock.verify());

  it('dokłada nagłówek Authorization: Bearer', () => {
    http.get('/api/users/me').subscribe();
    const req = httpMock.expectOne('/api/users/me');
    expect(req.request.headers.get('Authorization')).toBe(
      `Bearer ${store.accessToken()}`,
    );
    req.flush({});
  });

  it('na 401 odświeża tokeny i ponawia żądanie', async () => {
    const nowyAccess = fakeJwt({ sub: '1', email: 'a@b.pl', role: 'CLIENT' });
    let result: unknown;
    http.get('/api/users/me').subscribe((r) => (result = r));

    httpMock
      .expectOne('/api/users/me')
      .flush(null, { status: 401, statusText: 'Unauthorized' });

    const refreshReq = httpMock.expectOne('/api/auth/refresh');
    expect(refreshReq.request.body).toEqual({ refreshToken: 'stary-refresh' });
    refreshReq.flush({ accessToken: nowyAccess, refreshToken: 'nowy-refresh' });
    await flushMicrotasks();

    const retry = httpMock.expectOne('/api/users/me');
    expect(retry.request.headers.get('Authorization')).toBe(
      `Bearer ${nowyAccess}`,
    );
    retry.flush({ id: '1' });
    await flushMicrotasks();

    expect(result).toEqual({ id: '1' });
    expect(localStorage.getItem('bookit.refreshToken')).toBe('nowy-refresh');
  });

  it('udany refresh + błąd ponowionego żądania nie wylogowuje', async () => {
    const nowyAccess = fakeJwt({ sub: '1', email: 'a@b.pl', role: 'CLIENT' });
    let error: unknown;
    http.get('/api/users/me').subscribe({ error: (e) => (error = e) });

    httpMock
      .expectOne('/api/users/me')
      .flush(null, { status: 401, statusText: 'Unauthorized' });
    httpMock
      .expectOne('/api/auth/refresh')
      .flush({ accessToken: nowyAccess, refreshToken: 'nowy-refresh' });
    await flushMicrotasks();

    httpMock
      .expectOne('/api/users/me')
      .flush(null, { status: 500, statusText: 'Server Error' });
    await flushMicrotasks();

    expect(error).toBeTruthy();
    expect(store.isLoggedIn()).toBe(true);
    expect(localStorage.getItem('bookit.refreshToken')).toBe('nowy-refresh');
  });

  it('nieudany refresh → wylogowanie i propagacja błędu', async () => {
    let error: unknown;
    http.get('/api/users/me').subscribe({ error: (e) => (error = e) });

    httpMock
      .expectOne('/api/users/me')
      .flush(null, { status: 401, statusText: 'Unauthorized' });
    httpMock
      .expectOne('/api/auth/refresh')
      .flush(null, { status: 401, statusText: 'Unauthorized' });
    await flushMicrotasks();

    expect(error).toBeTruthy();
    expect(store.isLoggedIn()).toBe(false);
    expect(localStorage.getItem('bookit.accessToken')).toBeNull();
  });

  it('403 „musisz zmienić hasło" prowadzi na ekran zmiany hasła, nie na wylogowanie', async () => {
    const navigateByUrl = vi
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);
    let error: unknown;
    http.get('/api/bookings').subscribe({ error: (e) => (error = e) });

    httpMock.expectOne('/api/bookings').flush(
      {
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'Musisz zmienić hasło, zanim zrobisz cokolwiek innego',
      },
      { status: 403, statusText: 'Forbidden' },
    );
    await flushMicrotasks();

    expect(navigateByUrl).toHaveBeenCalledWith('/change-password');
    expect(store.mustChangePassword()).toBe(true);
    expect(store.isLoggedIn()).toBe(true);
    expect(error).toBeTruthy();
  });

  it('zwykłe 403 (zła rola) zostaje błędem żądania', async () => {
    const navigateByUrl = vi
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);
    let error: unknown;
    http.get('/api/admin/users').subscribe({ error: (e) => (error = e) });

    httpMock.expectOne('/api/admin/users').flush(
      {
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'Brak uprawnień',
      },
      { status: 403, statusText: 'Forbidden' },
    );
    await flushMicrotasks();

    expect(navigateByUrl).not.toHaveBeenCalled();
    expect(store.mustChangePassword()).toBe(false);
    expect(error).toBeTruthy();
  });

  it('401 z /api/auth/* nie odpala refresha', () => {
    let error: unknown;
    http
      .post('/api/auth/login', { email: 'a@b.pl', password: 'zle' })
      .subscribe({ error: (e) => (error = e) });

    httpMock
      .expectOne('/api/auth/login')
      .flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(error).toBeTruthy();
    // httpMock.verify() w afterEach wykryje ewentualny refresh
  });
});
