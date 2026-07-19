import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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
        message: 'Nieprawidłowy email lub hasło',
        error: 'Unauthorized',
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
});
