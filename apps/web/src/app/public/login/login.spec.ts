import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { setLocale } from '../../core/i18n/locale';
import { setValue, settle } from '../testing-helpers';
import Login from './login';

describe('Login', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Login],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
  });

  it('niepoprawny formularz: pokazuje błędy inline i nie wysyła żądania', async () => {
    const fixture = TestBed.createComponent(Login);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    el.querySelector('form')?.dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await fixture.whenStable();

    TestBed.inject(HttpTestingController).expectNone('/api/auth/login');
    expect(el.textContent).toContain('Email jest wymagany');
    expect(el.textContent).toContain('Hasło jest wymagane');
  });

  it('błędne dane: pokazuje komunikat serwera i nie czyści emaila', async () => {
    const fixture = TestBed.createComponent(Login);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    setValue(el.querySelector('#email') as HTMLInputElement, 'a@b.pl');
    setValue(el.querySelector('#password') as HTMLInputElement, 'zle-haslo');
    await fixture.whenStable();
    el.querySelector('form')?.dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await fixture.whenStable();

    const req = TestBed.inject(HttpTestingController).expectOne(
      '/api/auth/login',
    );
    req.flush(
      {
        statusCode: 401,
        code: 'UNAUTHORIZED',
        message: 'Nieprawidłowy email lub hasło',
      },
      { status: 401, statusText: 'Unauthorized' },
    );
    await settle(fixture);

    expect(el.querySelector('[role="alert"]')?.textContent).toContain(
      'Nieprawidłowy email lub hasło',
    );
    expect((el.querySelector('#email') as HTMLInputElement).value).toBe(
      'a@b.pl',
    );
  });

  // dowód, że ścieżka setLocale('en') → szablon faktycznie działa, a nie tylko sam słownik (#57)
  it('po przełączeniu na angielski renderuje angielskie etykiety i błędy walidacji', async () => {
    setLocale('en');
    const fixture = TestBed.createComponent(Login);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('h1')?.textContent?.trim()).toBe('Sign in');
    expect(el.textContent).toContain('Forgot your password?');

    el.querySelector('form')?.dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await fixture.whenStable();

    expect(el.textContent).toContain('Email is required');
    expect(el.textContent).toContain('Password is required');
    expect(el.textContent).not.toContain('Hasło');
  });
});
