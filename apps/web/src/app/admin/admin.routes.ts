import { Route } from '@angular/router';

export default [
  {
    // wspólny layout z pod-nawigacją; roleGuard('ADMIN') siedzi na rodzicu w app.routes.ts
    // i obejmuje całe poddrzewo, więc dzieci nie powtarzają guarda
    path: '',
    loadComponent: () => import('./admin-layout'),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'businesses' },
      { path: 'businesses', loadComponent: () => import('./admin-businesses') },
      { path: 'users', loadComponent: () => import('./admin-users') },
      // przed segmentem parametrycznym nic tu nie stoi, ale kolejność zostawiamy czytelną:
      // formularz jest podstroną listy użytkowników, bo stamtąd się na niego wchodzi
      { path: 'users/new', loadComponent: () => import('./new-admin') },
      {
        path: 'business-applications',
        loadComponent: () => import('./admin-business-applications'),
      },
    ],
  },
] satisfies Route[];
