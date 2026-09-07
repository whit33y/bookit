import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthStore, EMAIL_CHANGED_NOTICE } from '../core/auth/auth-store';
import { profileResponse, signInAs } from '../core/auth/auth-testing';
import { setLocale } from '../core/i18n/locale';
import { setValue, settle } from '../public/testing-helpers';
import EmailAddress, { canChangeEmail } from './email-address';

const EMAIL_URL = '/api/users/me/email';

type Fixture = ComponentFixture<EmailAddress>;

const html = (fixture: Fixture) => fixture.nativeElement as HTMLElement;

const textOf = (fixture: Fixture) =>
  (html(fixture).textContent ?? '').replace(/\s+/g, ' ').trim();

/** `profile: false` = ciche pobranie profilu padło; sekcja nie zna wtedy obecnego adresu. */
async function setup(options: { profile?: boolean } = {}) {
  const { profile = true } = options;
  localStorage.clear();
  setLocale('pl');
  signInAs({ sub: 'u1', email: 'anna.kowalska@firma.pl', role: 'CLIENT' });
  localStorage.setItem('bookit.refreshToken', 'stary-refresh');

  await TestBed.configureTestingModule({
    imports: [EmailAddress],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(EmailAddress);
  const http = TestBed.inject(HttpTestingController);
  const navigate = vi
    .spyOn(TestBed.inject(Router), 'navigate')
    .mockResolvedValue(true);
  fixture.detectChanges();

  const req = http.expectOne('/api/users/me');
  if (profile) {
    req.flush(profileResponse({ id: 'u1', email: 'anna.kowalska@firma.pl' }));
  } else {
    req.flush(null, { status: 500, statusText: 'Server Error' });
  }
  await settle(fixture);
  fixture.detectChanges();

  return { fixture, http, navigate, auth: TestBed.inject(AuthStore) };
}

const fill = (
  fixture: Fixture,
  values: { email: string; confirm: string; password: string },
) => {
  const input = (id: string) =>
    html(fixture).querySelector<HTMLInputElement>(`#${id}`)!;
  setValue(input('newEmail'), values.email);
  setValue(input('newEmailConfirm'), values.confirm);
  setValue(input('emailCurrentPassword'), values.password);
  fixture.detectChanges();
};

const submitForm = async (fixture: Fixture) => {
  html(fixture).querySelector('form')!.dispatchEvent(new Event('submit'));
  await settle(fixture);
  fixture.detectChanges();
};

const valid = {
  email: 'nowy@firma.pl',
  confirm: 'nowy@firma.pl',
  password: 'obecne-haslo1',
};

describe('EmailAddress', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    setLocale('pl');
  });

  it('ostrzega o wylogowaniu, zanim formularz zostanie wysłany', async () => {
    const { fixture } = await setup();

    expect(textOf(fixture)).toContain('wylogujemy');
    expect(textOf(fixture)).toContain('nowym adresem');
  });

  it('pokazuje obecny adres, żeby było widać, co się zmienia', async () => {
    const { fixture } = await setup();

    expect(textOf(fixture)).toContain('anna.kowalska@firma.pl');
  });

  it('nie wysyła nic, gdy powtórzenie adresu się nie zgadza', async () => {
    const { fixture, http } = await setup();
    fill(fixture, { ...valid, confirm: 'nowy@firna.pl' });

    await submitForm(fixture);

    http.expectNone(EMAIL_URL);
    expect(textOf(fixture)).toContain('Adresy e-mail muszą być takie same');
  });

  it('przepuszcza powtórzenie różniące się wielkością liter i spacjami', async () => {
    const { fixture, http } = await setup();
    fill(fixture, { ...valid, confirm: ' Nowy@Firma.PL ' });

    await submitForm(fixture);

    http
      .expectOne(EMAIL_URL)
      .flush(profileResponse({ email: 'nowy@firma.pl' }));
    await settle(fixture);
  });

  it('nie wysyła nic przy złym formacie adresu', async () => {
    const { fixture, http } = await setup();
    fill(fixture, { ...valid, email: 'nowy@firma', confirm: 'nowy@firma' });

    await submitForm(fixture);

    http.expectNone(EMAIL_URL);
    expect(textOf(fixture)).toContain('Nieprawidłowy format adresu email');
  });

  it('łapie adres równy obecnemu jeszcze przed wysyłką', async () => {
    const { fixture, http } = await setup();
    fill(fixture, {
      email: 'Anna.Kowalska@Firma.pl',
      confirm: 'Anna.Kowalska@Firma.pl',
      password: 'obecne-haslo1',
    });

    await submitForm(fixture);

    http.expectNone(EMAIL_URL);
    expect(textOf(fixture)).toContain('Nowy adres musi różnić się od obecnego');
  });

  it('wymaga obecnego hasła', async () => {
    const { fixture, http } = await setup();
    fill(fixture, { ...valid, password: '' });

    await submitForm(fixture);

    http.expectNone(EMAIL_URL);
    expect(textOf(fixture)).toContain('Obecne hasło jest wymagane');
  });

  it('udana zmiana czyści sesję i odsyła na /login z komunikatem', async () => {
    const { fixture, http, navigate } = await setup();
    fill(fixture, valid);

    await submitForm(fixture);

    const req = http.expectOne(EMAIL_URL);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({
      newEmail: 'nowy@firma.pl',
      newEmailConfirm: 'nowy@firma.pl',
      currentPassword: 'obecne-haslo1',
    });
    req.flush(profileResponse({ email: 'nowy@firma.pl' }));
    await settle(fixture);

    expect(localStorage.getItem('bookit.accessToken')).toBeNull();
    expect(localStorage.getItem('bookit.refreshToken')).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { notice: EMAIL_CHANGED_NOTICE },
    });
  });

  it('zajęty adres (409): własny komunikat i formularz bez zmian', async () => {
    const { fixture, http } = await setup();
    fill(fixture, valid);

    await submitForm(fixture);

    http.expectOne(EMAIL_URL).flush(
      {
        statusCode: 409,
        code: 'CONFLICT',
        message: 'Konto z tym adresem e-mail już istnieje',
      },
      { status: 409, statusText: 'Conflict' },
    );
    await settle(fixture);
    fixture.detectChanges();

    expect(textOf(fixture)).toContain(
      'Ten adres e-mail należy już do innego konta',
    );
    expect(
      html(fixture).querySelector<HTMLInputElement>('#newEmail')!.value,
    ).toBe('nowy@firma.pl');
    expect(localStorage.getItem('bookit.accessToken')).not.toBeNull();
  });

  it('złe hasło (400): inny komunikat niż konflikt, sesja zostaje', async () => {
    const { fixture, http, navigate } = await setup();
    fill(fixture, valid);

    await submitForm(fixture);

    http.expectOne(EMAIL_URL).flush(
      {
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: 'Nieprawidłowe hasło',
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await settle(fixture);
    fixture.detectChanges();

    expect(textOf(fixture)).toContain('Nieprawidłowe obecne hasło');
    expect(navigate).not.toHaveBeenCalled();
    expect(localStorage.getItem('bookit.refreshToken')).toBe('stary-refresh');
  });

  it('bez profilu formularz działa, a obecny adres bierze z tokenu', async () => {
    const { fixture, http } = await setup({ profile: false });

    expect(textOf(fixture)).toContain('anna.kowalska@firma.pl');

    fill(fixture, {
      email: 'anna.kowalska@firma.pl',
      confirm: 'anna.kowalska@firma.pl',
      password: 'obecne-haslo1',
    });
    await submitForm(fixture);

    http.expectNone(EMAIL_URL);
    expect(textOf(fixture)).toContain('Nowy adres musi różnić się od obecnego');

    fill(fixture, valid);
    await submitForm(fixture);

    http
      .expectOne(EMAIL_URL)
      .flush(profileResponse({ email: 'nowy@firma.pl' }));
    await settle(fixture);
  });

  // 409 i 400 wracają z API tym samym polskim zdaniem tylko przy polskim UI: przy angielskim
  // `apiErrorMessage` tłumaczy po kodzie, więc bez własnych kluczy oba byłyby nierozróżnialne
  it('po angielsku też odróżnia zajęty adres od złego hasła', async () => {
    const { fixture, http } = await setup();
    setLocale('en');
    fill(fixture, valid);

    await submitForm(fixture);
    http
      .expectOne(EMAIL_URL)
      .flush(
        { statusCode: 409, code: 'CONFLICT', message: 'zajęty' },
        { status: 409, statusText: 'Conflict' },
      );
    await settle(fixture);
    fixture.detectChanges();

    expect(textOf(fixture)).toContain('already belongs to another account');

    await submitForm(fixture);
    http
      .expectOne(EMAIL_URL)
      .flush(
        { statusCode: 400, code: 'BAD_REQUEST', message: 'złe hasło' },
        { status: 400, statusText: 'Bad Request' },
      );
    await settle(fixture);
    fixture.detectChanges();

    expect(textOf(fixture)).toContain('not your current password');
  });
});

// Predykat roli stoi obok sekcji, bo to ona jest jego jedynym powodem — ustawienia konta
// czytają go, żeby jej nie renderować (#168).
describe('canChangeEmail', () => {
  it('przepuszcza klienta i właściciela, odrzuca pracownika i administratora', () => {
    expect(canChangeEmail('CLIENT')).toBe(true);
    expect(canChangeEmail('OWNER')).toBe(true);
    expect(canChangeEmail('EMPLOYEE')).toBe(false);
    expect(canChangeEmail('ADMIN')).toBe(false);
    expect(canChangeEmail(null)).toBe(false);
    expect(canChangeEmail(undefined)).toBe(false);
  });
});
