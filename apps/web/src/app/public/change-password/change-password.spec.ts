import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthStore } from '../../core/auth/auth-store';
import { settle, setValue } from '../testing-helpers';
import ChangePassword from './change-password';

const fakeJwt = (payload: object) =>
  `header.${btoa(JSON.stringify(payload))}.signature`;

const CHANGE_URL = '/api/auth/change-password';

const adminToken = (mustChangePassword: boolean) =>
  fakeJwt({
    sub: 'u1',
    email: 'admin@bookit.pl',
    role: 'ADMIN',
    mustChangePassword,
  });

async function setup(mustChangePassword = true) {
  localStorage.clear();
  localStorage.setItem('bookit.accessToken', adminToken(mustChangePassword));
  localStorage.setItem('bookit.refreshToken', 'stary-refresh');

  await TestBed.configureTestingModule({
    imports: [ChangePassword],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ChangePassword);
  const http = TestBed.inject(HttpTestingController);
  const store = TestBed.inject(AuthStore);
  const navigateByUrl = vi
    .spyOn(TestBed.inject(Router), 'navigateByUrl')
    .mockResolvedValue(true);
  fixture.detectChanges();
  return { fixture, http, store, navigateByUrl };
}

type Fixture = ComponentFixture<ChangePassword>;

const html = (fixture: Fixture) => fixture.nativeElement as HTMLElement;

const textOf = (fixture: Fixture) =>
  (html(fixture).textContent ?? '').replace(/\s+/g, ' ').trim();

const fill = (
  fixture: Fixture,
  values: { current: string; next: string; confirm: string },
) => {
  const input = (id: string) =>
    html(fixture).querySelector<HTMLInputElement>(`#${id}`)!;
  setValue(input('currentPassword'), values.current);
  setValue(input('newPassword'), values.next);
  setValue(input('confirmPassword'), values.confirm);
  fixture.detectChanges();
};

const submitForm = async (fixture: Fixture) => {
  html(fixture).querySelector('form')!.dispatchEvent(new Event('submit'));
  await settle(fixture);
  fixture.detectChanges();
};

describe('ChangePassword', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('zmienia hasło, przyjmuje nowe tokeny i odsyła na stronę domową roli', async () => {
    const { fixture, http, store, navigateByUrl } = await setup();
    fill(fixture, {
      current: 'startowe123',
      next: 'wlasne-haslo1',
      confirm: 'wlasne-haslo1',
    });

    await submitForm(fixture);

    const req = http.expectOne(CHANGE_URL);
    expect(req.request.body).toEqual({
      currentPassword: 'startowe123',
      newPassword: 'wlasne-haslo1',
    });
    req.flush({
      accessToken: adminToken(false),
      refreshToken: 'nowy-refresh',
    });
    await settle(fixture);

    expect(store.mustChangePassword()).toBe(false);
    expect(localStorage.getItem('bookit.refreshToken')).toBe('nowy-refresh');
    expect(navigateByUrl).toHaveBeenCalledWith('/admin');
  });

  it('nie wysyła nic, gdy powtórzenie hasła się nie zgadza', async () => {
    const { fixture, http } = await setup();
    fill(fixture, {
      current: 'startowe123',
      next: 'wlasne-haslo1',
      confirm: 'wlasne-haslo2',
    });

    await submitForm(fixture);

    http.expectNone(CHANGE_URL);
    expect(textOf(fixture)).toContain('Hasła muszą być takie same');
  });

  it('pokazuje komunikat serwera przy złym obecnym haśle', async () => {
    const { fixture, http } = await setup();
    fill(fixture, {
      current: 'zle-haslo1',
      next: 'wlasne-haslo1',
      confirm: 'wlasne-haslo1',
    });

    await submitForm(fixture);
    http.expectOne(CHANGE_URL).flush(
      {
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: 'Nieprawidłowe obecne hasło',
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await settle(fixture);
    fixture.detectChanges();

    expect(textOf(fixture)).toContain('Nieprawidłowe obecne hasło');
  });

  it('spod flagi tłumaczy, czemu użytkownik tu jest', async () => {
    const { fixture } = await setup(true);
    expect(textOf(fixture)).toContain('Zmień hasło, zanim przejdziesz dalej');
  });

  it('bez flagi jest zwykłym ekranem zmiany hasła', async () => {
    const { fixture } = await setup(false);
    expect(textOf(fixture)).toContain('Zmiana hasła');
    expect(textOf(fixture)).not.toContain(
      'Zmień hasło, zanim przejdziesz dalej',
    );
  });
});
