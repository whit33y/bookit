import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { UserRole } from '../../core/auth/auth-store';
import { setLocale } from '../../core/i18n/locale';
import NavLinks from './nav-links';

/** Gospodarz z rolą w wejściu — komponent jest prezentacyjny, rola nie idzie ze store'u. */
@Component({
  selector: 'app-nav-host',
  imports: [NavLinks],
  template: `<app-nav-links [userRole]="role" />`,
})
class NavHost {
  role: UserRole | undefined = 'CLIENT';
}

@Component({ selector: 'app-blank', template: '' })
class Blank {}

async function setup(role: UserRole | undefined, url = '/client') {
  setLocale('pl');
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'client', component: NavHost },
        { path: 'client/favorites', component: NavHost },
        { path: '**', component: Blank },
      ]),
    ],
  });

  const harness = await RouterTestingHarness.create();
  const host = await harness.navigateByUrl(url, NavHost);
  host.role = role;
  harness.detectChanges();

  const links = () =>
    [...(harness.fixture.nativeElement as HTMLElement).querySelectorAll('a')];
  return { links, labels: () => links().map((a) => a.textContent?.trim()) };
}

describe('NavLinks', () => {
  it('pokazuje „Ulubione" obok „Moich wizyt" tylko klientowi', async () => {
    const { labels } = await setup('CLIENT');

    expect(labels()).toEqual(['Moje wizyty', 'Ulubione']);
  });

  it.each<UserRole>(['OWNER', 'EMPLOYEE', 'ADMIN'])(
    'nie pokazuje „Ulubionych" roli %s',
    async (role) => {
      const { labels } = await setup(role);

      expect(labels()).not.toContain('Ulubione');
    },
  );

  it('gość nie widzi „Ulubionych"', async () => {
    const { labels } = await setup(undefined);

    expect(labels()).toEqual(['Zaloguj', 'Rejestracja']);
  });

  it('link do ulubionych prowadzi pod /client/favorites', async () => {
    const { links } = await setup('CLIENT');

    expect(links().map((a) => a.getAttribute('href'))).toEqual([
      '/client',
      '/client/favorites',
    ]);
  });

  it('na liście ulubionych podświetlone jest „Ulubione", nie „Moje wizyty"', async () => {
    // dopasowanie po prefiksie zapaliłoby oba linki i dało dwa aria-current="page"
    const { links } = await setup('CLIENT', '/client/favorites');

    expect(
      links()
        .filter((a) => a.getAttribute('aria-current') === 'page')
        .map((a) => a.textContent?.trim()),
    ).toEqual(['Ulubione']);
  });

  it('na „Moich wizytach" podświetlone jest „Moje wizyty"', async () => {
    const { links } = await setup('CLIENT', '/client');

    expect(
      links()
        .filter((a) => a.getAttribute('aria-current') === 'page')
        .map((a) => a.textContent?.trim()),
    ).toEqual(['Moje wizyty']);
  });
});
