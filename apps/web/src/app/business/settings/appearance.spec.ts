import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import BusinessAppearance from './appearance';

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

/**
 * Gospodarz z sygnałami na wejściach — sekcja „Wygląd" dostaje wersje obrazów od ustawień
 * i sama je aktualizuje po wgraniu/usunięciu; host pozwala sprawdzić także reset po
 * przeładowaniu profilu przez rodzica.
 */
@Component({
  imports: [BusinessAppearance],
  template: `
    <app-business-appearance
      [businessId]="'biz-1'"
      [businessName]="'Salon Ola'"
      [logoVersion]="logo()"
      [coverVersion]="cover()"
    />
  `,
})
class Host {
  readonly logo = signal<string | null>(null);
  readonly cover = signal<string | null>(null);
}

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

function imageFile(name = 'logo.png', size = 1024): File {
  const file = new File([new Uint8Array(1)], name, { type: 'image/png' });
  Object.defineProperty(file, 'size', { value: size, configurable: true });
  return file;
}

describe('BusinessAppearance', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  function setup() {
    const fixture = TestBed.createComponent(Host);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const fileInput = (kind: 'logo' | 'cover') =>
      el.querySelector<HTMLInputElement>(`input[type=file][data-kind=${kind}]`)!;
    return { fixture, http, el, host: fixture.componentInstance, fileInput };
  }

  it('brak obrazów: podgląd pokazuje monogram, nie obrazek', () => {
    const { el } = setup();

    expect(el.querySelectorAll('img').length).toBe(0);
    expect(el.textContent).toContain('SO');
  });

  it('firma z obrazami: podgląd pokazuje oba, z wersją jako cache-busterem', async () => {
    const { fixture, el, host } = setup();
    host.logo.set('abc123');
    host.cover.set('def456');
    await fixture.whenStable();

    const sources = [...el.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    expect(sources).toContain('/api/businesses/biz-1/images/logo?v=abc123');
    expect(sources).toContain('/api/businesses/biz-1/images/cover?v=def456');
  });

  it('wybór pliku: PUT z polem file i natychmiastowa podmiana podglądu', async () => {
    const { fixture, http, el, fileInput } = setup();

    pick(fileInput('logo'), imageFile());
    await fixture.whenStable();

    const req = http.expectOne('/api/businesses/mine/images/logo');
    expect(req.request.method).toBe('PUT');
    expect((req.request.body as FormData).get('file')).toBeInstanceOf(File);
    req.flush({ kind: 'logo', version: 'nowa' });
    await settle(fixture);

    expect(el.querySelector('img')?.getAttribute('src')).toBe(
      '/api/businesses/biz-1/images/logo?v=nowa',
    );
  });

  it('trwający upload: kontrolki slotu są zablokowane', async () => {
    const { fixture, http, el, fileInput } = setup();

    pick(fileInput('logo'), imageFile());
    await fixture.whenStable();

    expect(fileInput('logo').disabled).toBe(true);
    expect(el.textContent).toContain('Wgrywanie…');

    http.expectOne('/api/businesses/mine/images/logo').flush({
      kind: 'logo',
      version: 'nowa',
    });
    await settle(fixture);
    expect(fileInput('logo').disabled).toBe(false);
  });

  it.each([
    [415, 'Nieobsługiwany format'],
    [413, 'za duży'],
    [422, 'odczytać'],
  ])('odrzucony plik (%i): komunikat właściwy dla przyczyny, obraz bez zmian', async (status, fragment) => {
    const { fixture, http, el, host, fileInput } = setup();
    host.logo.set('stara');
    await fixture.whenStable();

    pick(fileInput('logo'), imageFile());
    await fixture.whenStable();
    http.expectOne('/api/businesses/mine/images/logo').flush('err', {
      status,
      statusText: 'Rejected',
    });
    await settle(fixture);

    expect(el.textContent).toContain(fragment as string);
    expect(el.querySelector('img')?.getAttribute('src')).toBe(
      '/api/businesses/biz-1/images/logo?v=stara',
    );
  });

  it('plik ponad limit: brak żądania, komunikat o rozmiarze', async () => {
    const { fixture, http, el, fileInput } = setup();

    pick(fileInput('logo'), imageFile('duze.png', 6 * 1024 * 1024));
    await fixture.whenStable();

    http.expectNone('/api/businesses/mine/images/logo');
    expect(el.textContent).toContain('za duży');
  });

  it('usuwanie: przechodzi przez dialog potwierdzenia i przywraca monogram', async () => {
    const { fixture, http, el, host } = setup();
    host.logo.set('stara');
    await fixture.whenStable();

    el.querySelector<HTMLButtonElement>('button[data-remove=logo]')!.click();
    await fixture.whenStable();

    const dialog = el.querySelector('dialog')!;
    expect(dialog.open).toBe(true);
    // przycisk potwierdzenia w modalu — ostatni z dwóch (anuluj, potwierdź)
    const buttons = [...dialog.querySelectorAll('button')];
    buttons[buttons.length - 1]!.click();
    await fixture.whenStable();

    const req = http.expectOne('/api/businesses/mine/images/logo');
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    await settle(fixture);

    expect(el.querySelectorAll('img').length).toBe(0);
    expect(el.textContent).toContain('SO');
  });

  it('anulowanie dialogu: nie wysyła DELETE', async () => {
    const { fixture, http, el, host } = setup();
    host.logo.set('stara');
    await fixture.whenStable();

    el.querySelector<HTMLButtonElement>('button[data-remove=logo]')!.click();
    await fixture.whenStable();
    const dialog = el.querySelector('dialog')!;
    dialog.querySelector('button')!.click();
    await fixture.whenStable();

    http.expectNone('/api/businesses/mine/images/logo');
  });
});
