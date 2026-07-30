import { Route } from '@angular/router';
import { authGuard, guestGuard, roleGuard } from './core/auth/auth.guard';

export const appRoutes: Route[] = [
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
    // dostępne dla każdego zalogowanego (CLIENT zakłada firmę); OWNER z firmą dostaje 409 przy submit
    path: 'create-business',
    canActivate: [authGuard],
    loadComponent: () => import('./business/create-business/create-business'),
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
