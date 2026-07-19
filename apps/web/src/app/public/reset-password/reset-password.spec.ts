import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  Router,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { setValue, settle } from '../testing-helpers';
import ResetPassword from './reset-password';

const setup = async (token: string | null) => {
  localStorage.clear();
  await TestBed.configureTestingModule({
    imports: [ResetPassword],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            queryParamMap: convertToParamMap(token ? { token } : {}),
          },
        },
      },
    ],
  }).compileComponents();
};

describe('ResetPassword', () => {
  it('wysyła token i hasło, po sukcesie czyści sesję i przekierowuje na /login', async () => {
    await setup('abc123');
    localStorage.setItem('bookit.accessToken', 'stary-token');
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    const fixture = TestBed.createComponent(ResetPassword);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    setValue(el.querySelector('#password') as HTMLInputElement, 'noweHaslo1');
    await fixture.whenStable();
    el.querySelector('form')?.dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await fixture.whenStable();

    const req = TestBed.inject(HttpTestingController).expectOne(
      '/api/auth/reset-password',
    );
    expect(req.request.body).toEqual({
      token: 'abc123',
      password: 'noweHaslo1',
    });
    req.flush({ message: 'Hasło zostało zmienione' });
    await settle(fixture);

    expect(navigate).toHaveBeenCalledWith(['/login']);
    // backend unieważnił sesje — lokalna też musi zniknąć, inaczej guestGuard odbije /login
    expect(localStorage.getItem('bookit.accessToken')).toBeNull();
  });

  it('400 tokenowe: pokazuje komunikat o wygasłym tokenie i link do ponowienia', async () => {
    await setup('abc123');
    const fixture = TestBed.createComponent(ResetPassword);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    setValue(el.querySelector('#password') as HTMLInputElement, 'noweHaslo1');
    await fixture.whenStable();
    el.querySelector('form')?.dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await fixture.whenStable();

    TestBed.inject(HttpTestingController)
      .expectOne('/api/auth/reset-password')
      .flush(
        {
          statusCode: 400,
          message: 'Nieprawidłowy lub wygasły token',
          error: 'Bad Request',
        },
        { status: 400, statusText: 'Bad Request' },
      );
    await settle(fixture);

    expect(el.querySelector('[role="alert"]')?.textContent).toContain(
      'wygasł lub został już użyty',
    );
    expect(
      el.querySelector('a[href="/forgot-password"]')?.textContent,
    ).toContain('Wyślij nowy link');
    expect(el.querySelector('form')).toBeNull();
    // WCAG: fokus przeniesiony na nagłówek nowego widoku
    expect(document.activeElement).toBe(el.querySelector('h1'));
  });

  it('400 walidacyjne (nie-tokenowe): pokazuje błąd serwera, formularz zostaje', async () => {
    await setup('abc123');
    const fixture = TestBed.createComponent(ResetPassword);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    setValue(el.querySelector('#password') as HTMLInputElement, 'noweHaslo1');
    await fixture.whenStable();
    el.querySelector('form')?.dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await fixture.whenStable();

    TestBed.inject(HttpTestingController)
      .expectOne('/api/auth/reset-password')
      .flush(
        {
          statusCode: 400,
          message: ['password must match policy'],
          error: 'Bad Request',
        },
        { status: 400, statusText: 'Bad Request' },
      );
    await settle(fixture);

    expect(el.querySelector('[role="alert"]')?.textContent).toContain(
      'Coś poszło nie tak',
    );
    expect(el.querySelector('form')).not.toBeNull();
  });

  it('brak tokenu w URL: od razu błąd, bez formularza i bez żądania', async () => {
    await setup(null);
    const fixture = TestBed.createComponent(ResetPassword);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('form')).toBeNull();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(
      'wygasł lub został już użyty',
    );
    TestBed.inject(HttpTestingController).verify();
  });

  it('hasło krótsze niż 8 znaków: błąd walidacji, brak żądania', async () => {
    await setup('abc123');
    const fixture = TestBed.createComponent(ResetPassword);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    setValue(el.querySelector('#password') as HTMLInputElement, 'krotkie');
    await fixture.whenStable();
    el.querySelector('form')?.dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await fixture.whenStable();

    TestBed.inject(HttpTestingController).expectNone(
      '/api/auth/reset-password',
    );
    expect(el.textContent).toContain('Hasło musi mieć co najmniej 8 znaków');
  });
});
