import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { setValue, settle } from '../testing-helpers';
import Register from './register';

const fakeJwt = (payload: object) =>
  `header.${btoa(JSON.stringify(payload))}.signature`;

describe('Register', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Register],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
  });

  it('niepoprawny formularz: pokazuje błędy inline i nie wysyła żądania', async () => {
    const fixture = TestBed.createComponent(Register);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    el.querySelector('form')?.dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await fixture.whenStable();

    TestBed.inject(HttpTestingController).expectNone('/api/auth/register');
    expect(el.textContent).toContain('Imię jest wymagane');
    expect(el.textContent).toContain('Nazwisko jest wymagane');
    expect(el.textContent).toContain('Email jest wymagany');
    expect(el.textContent).toContain('Hasło jest wymagane');
  });

  it('sukces: wysyła dane, auto-loguje i przekierowuje na stronę roli', async () => {
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);
    const fixture = TestBed.createComponent(Register);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    setValue(el.querySelector('#firstName') as HTMLInputElement, 'Jan');
    setValue(el.querySelector('#lastName') as HTMLInputElement, 'Kowalski');
    setValue(el.querySelector('#email') as HTMLInputElement, 'jan@bookit.pl');
    setValue(el.querySelector('#password') as HTMLInputElement, 'tajnehaslo');
    await fixture.whenStable();
    el.querySelector('form')?.dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await fixture.whenStable();

    const req = TestBed.inject(HttpTestingController).expectOne(
      '/api/auth/register',
    );
    expect(req.request.body).toEqual({
      firstName: 'Jan',
      lastName: 'Kowalski',
      email: 'jan@bookit.pl',
      password: 'tajnehaslo',
    });
    req.flush({
      accessToken: fakeJwt({ sub: '1', email: 'jan@bookit.pl', role: 'CLIENT' }),
      refreshToken: 'refresh',
    });
    await settle(fixture);

    expect(navigate).toHaveBeenCalledWith('/client');
  });
});
