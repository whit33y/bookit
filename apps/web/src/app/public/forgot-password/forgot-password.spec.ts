import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { setValue, settle } from '../testing-helpers';
import ForgotPassword from './forgot-password';

describe('ForgotPassword', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [ForgotPassword],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
  });

  it('niepoprawny email: pokazuje błąd inline i nie wysyła żądania', async () => {
    const fixture = TestBed.createComponent(ForgotPassword);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    el.querySelector('form')?.dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await fixture.whenStable();

    TestBed.inject(HttpTestingController).expectNone(
      '/api/auth/forgot-password',
    );
    expect(el.textContent).toContain('Email jest wymagany');
  });

  it('wysyła POST /auth/forgot-password i pokazuje neutralny komunikat', async () => {
    const fixture = TestBed.createComponent(ForgotPassword);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    setValue(el.querySelector('#email') as HTMLInputElement, 'a@b.pl');
    await fixture.whenStable();
    el.querySelector('form')?.dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await fixture.whenStable();

    const req = TestBed.inject(HttpTestingController).expectOne(
      '/api/auth/forgot-password',
    );
    expect(req.request.body).toEqual({ email: 'a@b.pl' });
    req.flush({ message: 'Jeśli konto istnieje, wysłaliśmy link' });
    await settle(fixture);

    expect(el.querySelector('[role="status"]')?.textContent).toContain(
      'Jeśli konto istnieje, wysłaliśmy link',
    );
    expect(el.querySelector('form')).toBeNull();
    // WCAG: fokus przeniesiony na nagłówek nowego widoku
    expect(document.activeElement).toBe(el.querySelector('h1'));
  });

  it('429: pokazuje polski komunikat o zbyt wielu próbach', async () => {
    const fixture = TestBed.createComponent(ForgotPassword);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    setValue(el.querySelector('#email') as HTMLInputElement, 'a@b.pl');
    await fixture.whenStable();
    el.querySelector('form')?.dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await fixture.whenStable();

    TestBed.inject(HttpTestingController)
      .expectOne('/api/auth/forgot-password')
      .flush(
        { statusCode: 429, message: 'ThrottlerException: Too Many Requests' },
        { status: 429, statusText: 'Too Many Requests' },
      );
    await settle(fixture);

    expect(el.querySelector('[role="alert"]')?.textContent).toContain(
      'Zbyt wiele prób',
    );
    expect(el.querySelector('form')).not.toBeNull();
  });

  it('błąd serwera: pokazuje komunikat, formularz zostaje', async () => {
    const fixture = TestBed.createComponent(ForgotPassword);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    setValue(el.querySelector('#email') as HTMLInputElement, 'a@b.pl');
    await fixture.whenStable();
    el.querySelector('form')?.dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await fixture.whenStable();

    TestBed.inject(HttpTestingController)
      .expectOne('/api/auth/forgot-password')
      .flush(null, { status: 500, statusText: 'Internal Server Error' });
    await settle(fixture);

    expect(el.querySelector('[role="alert"]')?.textContent).toContain(
      'Coś poszło nie tak',
    );
    expect(el.querySelector('form')).not.toBeNull();
  });
});
