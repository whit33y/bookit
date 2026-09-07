import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { UserRole } from '../core/auth/auth-store';
import { signInAs } from '../core/auth/auth-testing';
import clientRoutes from './client.routes';

@Component({ selector: 'app-blank', template: '' })
class Blank {}

/** Wejście na trasę spod `client.routes.ts` z podaną rolą; zwraca adres po nawigacji. */
async function navigateAs(role: UserRole, url: string): Promise<string> {
  localStorage.clear();
  signInAs({ role });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'login', component: Blank },
        { path: 'client', children: clientRoutes },
      ]),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });

  const router = TestBed.inject(Router);
  await router.navigateByUrl(url);
  return router.url;
}

/**
 * Wiring guardów, nie ich logika (ta ma testy w `auth.guard.spec.ts`): `roleGuard` zwraca
 * przy każdym wywołaniu nową funkcję, więc trasy nie da się sprawdzić przez porównanie
 * referencji — zostaje zachowanie.
 */
describe('clientRoutes', () => {
  afterEach(() => localStorage.clear());

  it('wpuszcza klienta na listę ulubionych', async () => {
    expect(await navigateAs('CLIENT', '/client/favorites')).toBe('/client/favorites');
  });

  it.each<UserRole>(['OWNER', 'EMPLOYEE', 'ADMIN'])(
    'odbija rolę %s z listy ulubionych na /login z celem powrotu',
    async (role) => {
      expect(await navigateAs(role, '/client/favorites')).toBe(
        '/login?returnUrl=%2Fclient%2Ffavorites',
      );
    },
  );

  it('„Moje wizyty" zostają dla każdej zalogowanej roli', async () => {
    expect(await navigateAs('OWNER', '/client')).toBe('/client');
  });
});
