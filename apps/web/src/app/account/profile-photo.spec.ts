import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthStore } from '../core/auth/auth-store';
import { profileResponse } from '../core/auth/auth-testing';
import ProfilePhoto from './profile-photo';

// jsdom nie implementuje showModal()/close() — ten sam lokalny polyfill co w
// shared/confirm-dialog.spec.ts
beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

const fakeJwt = (payload: object) =>
  `header.${btoa(JSON.stringify(payload))}.signature`;

/** jsdom nie ma `DataTransfer`, więc listę plików podkładamy wprost na input. */
function pick(input: HTMLInputElement, file: File): void {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}

/** Odpowiedź HTTP wraca przez Promise (firstValueFrom) — sam whenStable nie wystarczy. */
async function settle(fixture: { whenStable: () => Promise<unknown> }): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await fixture.whenStable();
}

function imageFile(name = 'ja.png', size = 1024): File {
  const file = new File([new Uint8Array(1)], name, { type: 'image/png' });
  Object.defineProperty(file, 'size', { value: size, configurable: true });
  return file;
}

/** `avatarVersion === null` = konto bez zdjęcia; `profile: false` = pobranie profilu padło. */
async function setup(
  options: { avatarVersion?: string | null; profile?: boolean } = {},
) {
  const { avatarVersion = null, profile = true } = options;
  localStorage.clear();
  localStorage.setItem(
    'bookit.accessToken',
    fakeJwt({ sub: 'u1', email: 'anna.kowalska@firma.pl', role: 'CLIENT' }),
  );
  await TestBed.configureTestingModule({
    imports: [ProfilePhoto],
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(ProfilePhoto);
  const http = TestBed.inject(HttpTestingController);
  fixture.detectChanges();

  const req = http.expectOne('/api/users/me');
  if (profile) {
    req.flush(profileResponse({ id: 'u1', avatarVersion }));
  } else {
    req.flush(null, { status: 500, statusText: 'Server Error' });
  }
  await settle(fixture);

  const el = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    http,
    el,
    auth: TestBed.inject(AuthStore),
    fileInput: () =>
      el.querySelector<HTMLInputElement>('input[type=file][data-photo-input]'),
    removeButton: () => el.querySelector<HTMLButtonElement>('button[data-photo-remove]'),
  };
}

describe('ProfilePhoto', () => {
  it('konto bez zdjęcia: podgląd pokazuje monogram imienia i nazwiska', async () => {
    const { el, removeButton } = await setup();

    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain('AK');
    // nie ma czego usuwać — przycisk usuwania pojawia się dopiero razem ze zdjęciem
    expect(removeButton()).toBeNull();
  });

  it('konto ze zdjęciem: podgląd pokazuje obraz z wersją jako cache-busterem', async () => {
    const { el } = await setup({ avatarVersion: 'abc123' });

    expect(el.querySelector('img')?.getAttribute('src')).toBe(
      '/api/users/u1/avatar?v=abc123',
    );
  });

  it('wybór pliku: PUT z polem file, nowe zdjęcie w podglądzie i w stanie aplikacji', async () => {
    const { fixture, http, el, auth, fileInput } = await setup();

    pick(fileInput()!, imageFile());
    await fixture.whenStable();

    const req = http.expectOne('/api/users/me/avatar');
    expect(req.request.method).toBe('PUT');
    expect((req.request.body as FormData).get('file')).toBeInstanceOf(File);
    req.flush({ version: 'nowa' });
    await settle(fixture);

    expect(el.querySelector('img')?.getAttribute('src')).toBe(
      '/api/users/u1/avatar?v=nowa',
    );
    // to samo źródło czyta menu użytkownika, więc zmienia się bez przeładowania strony
    expect(auth.profilePhoto()).toBe('/api/users/u1/avatar?v=nowa');
  });

  it('ten sam plik wybrany dwa razy z rzędu leci drugi raz', async () => {
    const { fixture, http, fileInput } = await setup();

    pick(fileInput()!, imageFile());
    await fixture.whenStable();
    http.expectOne('/api/users/me/avatar').flush({ version: 'nowa' });
    await settle(fixture);

    expect(fileInput()!.value).toBe('');
    pick(fileInput()!, imageFile());
    await fixture.whenStable();
    http.expectOne('/api/users/me/avatar').flush({ version: 'nowsza' });
    await settle(fixture);
  });

  it('trwający upload: kontrolki są zablokowane, widać stan zajętości', async () => {
    const { fixture, http, el, fileInput, removeButton } = await setup({
      avatarVersion: 'stara',
    });

    pick(fileInput()!, imageFile());
    await fixture.whenStable();

    expect(fileInput()!.disabled).toBe(true);
    expect(removeButton()!.disabled).toBe(true);
    expect(el.textContent).toContain('Wgrywanie…');

    http.expectOne('/api/users/me/avatar').flush({ version: 'nowa' });
    await settle(fixture);
    expect(fileInput()!.disabled).toBe(false);
  });

  it.each([
    [415, 'Nieobsługiwany format'],
    [413, 'za duży'],
    [422, 'odczytać'],
  ])(
    'odrzucony plik (%i): komunikat właściwy dla przyczyny, zdjęcie bez zmian',
    async (status, fragment) => {
      const { fixture, http, el, fileInput } = await setup({ avatarVersion: 'stara' });

      pick(fileInput()!, imageFile());
      await fixture.whenStable();
      http.expectOne('/api/users/me/avatar').flush('err', {
        status: status as number,
        statusText: 'Rejected',
      });
      await settle(fixture);

      expect(el.textContent).toContain(fragment as string);
      expect(el.querySelector('img')?.getAttribute('src')).toBe(
        '/api/users/u1/avatar?v=stara',
      );
    },
  );

  it('plik ponad limit: brak żądania, komunikat o rozmiarze', async () => {
    const { fixture, http, el, fileInput } = await setup();

    pick(fileInput()!, imageFile('duze.png', 6 * 1024 * 1024));
    await fixture.whenStable();

    http.expectNone('/api/users/me/avatar');
    expect(el.textContent).toContain('za duży');
  });

  it('usuwanie: przechodzi przez dialog potwierdzenia i przywraca monogram', async () => {
    const { fixture, http, el, auth, removeButton } = await setup({
      avatarVersion: 'stara',
    });

    removeButton()!.click();
    await fixture.whenStable();

    const dialog = el.querySelector('dialog')!;
    expect(dialog.open).toBe(true);
    // przycisk potwierdzenia w modalu — ostatni z dwóch (anuluj, potwierdź)
    const buttons = [...dialog.querySelectorAll('button')];
    buttons[buttons.length - 1]!.click();
    await fixture.whenStable();

    const req = http.expectOne('/api/users/me/avatar');
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    await settle(fixture);

    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain('AK');
    expect(auth.profilePhoto()).toBeNull();
  });

  it('anulowanie dialogu: nie wysyła DELETE', async () => {
    const { fixture, http, el, removeButton } = await setup({ avatarVersion: 'stara' });

    removeButton()!.click();
    await fixture.whenStable();
    el.querySelector('dialog')!.querySelector('button')!.click();
    await fixture.whenStable();

    http.expectNone('/api/users/me/avatar');
  });

  it('nieudane usunięcie: komunikat, zdjęcie zostaje', async () => {
    const { fixture, http, el, removeButton } = await setup({ avatarVersion: 'stara' });

    removeButton()!.click();
    await fixture.whenStable();
    const buttons = [...el.querySelector('dialog')!.querySelectorAll('button')];
    buttons[buttons.length - 1]!.click();
    await fixture.whenStable();
    http.expectOne('/api/users/me/avatar').flush('err', {
      status: 500,
      statusText: 'Server Error',
    });
    await settle(fixture);

    expect(el.textContent).toContain('Nie udało się usunąć zdjęcia profilowego');
    expect(el.querySelector('img')?.getAttribute('src')).toBe(
      '/api/users/u1/avatar?v=stara',
    );
  });

  it('bez profilu: zamiast pustego kwadratu mówi, że sekcja jeszcze nie jest gotowa', async () => {
    const { el, fileInput } = await setup({ profile: false });

    expect(fileInput()).toBeNull();
    expect(el.textContent).toContain('kiedy wczytają się dane konta');
  });
});
