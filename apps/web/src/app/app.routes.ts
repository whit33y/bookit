import { Route } from '@angular/router';
import {
  authGuard,
  guestGuard,
  passwordChangeGuard,
  roleGuard,
} from './core/auth/auth.guard';

const routes: Route[] = [
  // bez guestGuard: to strona domowa klienta (#160) — guard odsyłałby go tutaj z /login,
  // a stąd znowu na siebie samego
  { path: '', loadComponent: () => import('./public/landing/landing') },
  {
    // literalna ścieżka — musi być przed ':slug', inaczej trasa parametryczna
    // przechwyci /search jako slug firmy
    path: 'search',
    loadComponent: () => import('./public/search/search'),
  },
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./public/login/login'),
  },
  {
    path: 'register',
    canActivate: [guestGuard],
    loadComponent: () => import('./public/register/register'),
  },
  {
    // bez guestGuard: „Wyślij nowy link” z ekranu wygasłego tokenu musi działać też przy żywej sesji
    path: 'forgot-password',
    loadComponent: () => import('./public/forgot-password/forgot-password'),
  },
  {
    // bez guestGuard: link z maila musi się otworzyć nawet przy żywej sesji
    path: 'reset-password',
    loadComponent: () => import('./public/reset-password/reset-password'),
  },
  {
    // dostępne dla każdego zalogowanego: komponent sam rozpoznaje stan zgłoszenia (#142) —
    // formularz, ekran „czeka na akceptację" albo przekierowanie do panelu po akceptacji
    path: 'create-business',
    canActivate: [authGuard],
    loadComponent: () => import('./business/create-business/create-business'),
  },
  {
    // wymuszona zmiana hasła (#146): trasa dla każdego zalogowanego, bo zmiana hasła nie
    // jest przywilejem roli — konto spod flagi tylko nie może z niej wyjść (passwordChangeGuard)
    path: 'change-password',
    canActivate: [authGuard],
    loadComponent: () => import('./public/change-password/change-password'),
  },
  {
    // dla każdej zalogowanej roli: hasło i dane osobowe ma każde konto, a nie tylko klient
    // czy właściciel (CONTEXT.md → „Ustawienia konta")
    path: 'account',
    canActivate: [authGuard],
    loadComponent: () => import('./account/account'),
  },
  {
    path: 'client',
    canActivate: [authGuard],
    loadChildren: () => import('./client/client.routes'),
  },
  {
    path: 'business',
    canActivate: [roleGuard('OWNER', 'EMPLOYEE')],
    loadChildren: () => import('./business/business.routes'),
  },
  {
    path: 'admin',
    canActivate: [roleGuard('ADMIN')],
    loadChildren: () => import('./admin/admin.routes'),
  },
  {
    // po wszystkich literalnych ścieżkach, żeby nie przesłaniać login/register/itd.
    path: ':slug',
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./public/business-profile/business-profile'),
      },
      {
        // bez authGuard: niezalogowany przechodzi wizard i dopiero przy finalizacji
        // trafia na /login?returnUrl=… (#29)
        path: 'rezerwacja',
        loadComponent: () => import('./public/booking-wizard/booking-wizard'),
      },
    ],
  },
  { path: '**', loadComponent: () => import('./public/not-found/not-found') },
];

/**
 * `passwordChangeGuard` doklejony do każdej trasy najwyższego poziomu (#146) zamiast
 * wpisywania go w każdą z osobna: „z każdej trasy" znaczy naprawdę z każdej, a lista rośnie —
 * ręczne powtórzenie prędzej czy później zgubiłoby nową trasę. Guardy dzieci lazy siedzą
 * pod tymi trasami, więc poddrzewa są objęte razem z rodzicem.
 *
 * Idzie pierwszy: konto spod flagi ma trafić na zmianę hasła, a nie na `/login` z roleGuarda.
 */
export const appRoutes: Route[] = routes.map((route) => ({
  ...route,
  canActivate: [passwordChangeGuard, ...(route.canActivate ?? [])],
}));
