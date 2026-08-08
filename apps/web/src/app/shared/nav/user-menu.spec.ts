import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { AuthStore, type UserRole } from '../../core/auth/auth-store';
import UserMenu from './user-menu';

const fakeJwt = (payload: object) =>
  `header.${btoa(JSON.stringify(payload))}.signature`;

async function setup(role: UserRole, layout: 'menu' | 'panel' = 'menu') {
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
  fixture.componentRef.setInput('layout', layout);
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

  it('dla klienta skrót prowadzi do jego wizyt', async () => {
    const { fixture, el, trigger } = await setup('CLIENT');

    trigger()?.click();
    fixture.detectChanges();

    const home = el.querySelector('#user-menu-panel a');
    expect(home?.getAttribute('href')).toBe('/client');
    expect(home?.textContent).toContain('Moje wizyty');
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

  it('layout="panel" wypisuje pozycje płasko, bez przycisku rozwijającego', async () => {
    const { el, trigger, logoutButton } = await setup('OWNER', 'panel');

    expect(trigger()).toBeNull();
    expect(el.textContent).toContain('anna.kowalska@firma.pl');
    expect(el.querySelector('a')?.getAttribute('href')).toBe('/business');
    expect(logoutButton()).toBeDefined();
  });
});
