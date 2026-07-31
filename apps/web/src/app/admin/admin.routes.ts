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
    ],
  },
] satisfies Route[];
