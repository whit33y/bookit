import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { AuthStore, type UserRole } from '../../core/auth/auth-store';
import { profileResponse } from '../../core/auth/auth-testing';
import UserMenu from './user-menu';

const fakeJwt = (payload: object) =>
  `header.${btoa(JSON.stringify(payload))}.signature`;

/** Profil, który `AuthStore` pobiera po wejściu na stronę (#161); `null` = pobranie padło. */
async function setup(role: UserRole, name: { firstName: string; lastName: string } | null = null) {
  localStorage.clear();
  localStorage.setItem(
    'bookit.accessToken',
    fakeJwt({ sub: '1', email: 'anna.kowalska@firma.pl', role }),
  );
  await TestBed.configureTestingModule({
    imports: [UserMenu],
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(UserMenu);
  fixture.detectChanges();

  const req = TestBed.inject(HttpTestingController).expectOne('/api/users/me');
  if (name) {
    req.flush(profileResponse({ ...name, role }));
  } else {
    req.flush(null, { status: 500, statusText: 'Server Error' });
  }
  await Promise.resolve();
  fixture.detectChanges();

  const el = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    el,
    trigger: () => el.querySelector<HTMLButtonElement>('button[aria-controls="user-menu-panel"]'),
    panel: () => el.querySelector('#user-menu-panel'),
    logoutButton: () =>
      Array.from(el.querySelectorAll('button')).find((b) =>
        (b.textContent ?? '').includes('Wyloguj'),
      ),
  };
}

describe('UserMenu', () => {
  it('rozwija i zwija panel przyciskiem, raportując stan w aria-expanded', async () => {
    const { fixture, trigger, panel } = await setup('CLIENT');

    expect(trigger()?.getAttribute('aria-expanded')).toBe('false');
    expect(panel()).toBeNull();

    trigger()?.click();
    fixture.detectChanges();
    expect(trigger()?.getAttribute('aria-expanded')).toBe('true');
    expect(panel()).not.toBeNull();

    trigger()?.click();
    fixture.detectChanges();
    expect(panel()).toBeNull();
  });

  it('Escape zamyka panel i oddaje fokus przyciskowi', async () => {
    const { fixture, el, trigger, panel } = await setup('CLIENT');

    trigger()?.click();
    fixture.detectChanges();

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('Escape obsłużony przez menu nie idzie dalej — panel hamburgera zostaje otwarty', async () => {
    const { fixture, el, trigger } = await setup('CLIENT');
    const onDocument = vi.fn();
    document.addEventListener('keydown', onDocument);

    trigger()?.click();
    fixture.detectChanges();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(onDocument).not.toHaveBeenCalled();

    // przy zwiniętym menu Escape ma dolecieć do dokumentu (zamknie panel hamburgera)
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onDocument).toHaveBeenCalledOnce();

    document.removeEventListener('keydown', onDocument);
  });

  it('klik poza menu zamyka panel', async () => {
    const { fixture, trigger, panel } = await setup('CLIENT');

    trigger()?.click();
    fixture.detectChanges();
    expect(panel()).not.toBeNull();

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(panel()).toBeNull();
  });

  it('pokazuje e-mail zalogowanego i skrót do strony domowej jego roli', async () => {
    const { fixture, el, trigger } = await setup('OWNER');

    trigger()?.click();
    fixture.detectChanges();

    expect(el.textContent).toContain('anna.kowalska@firma.pl');
    const home = el.querySelector('#user-menu-panel a');
    expect(home?.getAttribute('href')).toBe('/business');
    expect(home?.textContent).toContain('Panel firmy');
  });

  it('dla klienta skrót prowadzi na stronę główną', async () => {
    const { fixture, el, trigger } = await setup('CLIENT');

    trigger()?.click();
    fixture.detectChanges();

    const home = el.querySelector('#user-menu-panel a');
    expect(home?.getAttribute('href')).toBe('/');
    expect(home?.textContent).toContain('Strona główna');
  });

  it('pokazuje monogram z inicjałów i mówi czytnikowi, czyje to menu', async () => {
    const { trigger } = await setup('CLIENT', {
      firstName: 'Anna',
      lastName: 'Kowalska',
    });

    expect(trigger()?.textContent?.trim()).toBe('AK');
    expect(trigger()?.querySelector('svg')).toBeNull();
    expect(trigger()?.getAttribute('aria-label')).toBe('Menu użytkownika — Anna Kowalska');
  });

  it('zdjęcie profilowe wchodzi na miejsce monogramu, bez przeładowania strony', async () => {
    const { fixture, trigger } = await setup('CLIENT', {
      firstName: 'Anna',
      lastName: 'Kowalska',
    });

    // tak samo jak po wgraniu zdjęcia w ustawieniach konta (#164)
    TestBed.inject(AuthStore).setAvatarVersion('abc123');
    fixture.detectChanges();

    const photo = trigger()?.querySelector('img');
    expect(photo?.getAttribute('src')).toBe('/api/users/1/avatar?v=abc123');
    // sam obraz nic czytnikowi nie mówi — czyje to menu, niesie etykieta przycisku
    expect(photo?.getAttribute('alt')).toBe('');
    expect(trigger()?.textContent?.trim()).toBe('');
  });

  it('bez profilu (nieudane GET /users/me) zostaje ikona sylwetki', async () => {
    const { trigger } = await setup('CLIENT');

    expect(trigger()?.querySelector('svg')).not.toBeNull();
    expect(trigger()?.getAttribute('aria-label')).toBe('Menu użytkownika');
  });

  it('panel pokazuje imię i nazwisko nad adresem', async () => {
    const { fixture, el, trigger } = await setup('CLIENT', {
      firstName: 'Anna',
      lastName: 'Kowalska',
    });

    trigger()?.click();
    fixture.detectChanges();

    const panel = el.querySelector('#user-menu-panel');
    expect(panel?.textContent).toContain('Anna Kowalska');
    expect(panel?.textContent).toContain('anna.kowalska@firma.pl');
  });

  it('„Wyloguj" woła AuthStore.logout()', async () => {
    const { fixture, trigger, logoutButton } = await setup('CLIENT');
    // stub, żeby test nie odpalał prawdziwej nawigacji na /login
    const logout = vi.spyOn(TestBed.inject(AuthStore), 'logout').mockReturnValue(undefined);

    trigger()?.click();
    fixture.detectChanges();
    logoutButton()?.click();

    expect(logout).toHaveBeenCalledOnce();
  });
});
