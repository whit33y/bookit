import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthStore } from './auth-store';

const fakeJwt = (payload: object) =>
  `header.${btoa(JSON.stringify(payload))}.signature`;

describe('AuthStore', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient()],
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
