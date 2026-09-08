import { Route } from '@angular/router';
import { roleGuard } from '../core/auth/auth.guard';

export default [
  { path: '', loadComponent: () => import('./my-bookings') },
  {
    // roleGuard, inaczej niż „Moje wizyty" pod samym authGuardem (app.routes.ts): wizyty ma
    // każde zalogowane konto, a ulubione wyłącznie CLIENT (CONTEXT.md → „Ulubiona firma"),
    // więc pozostałe role dostałyby z API 403 zamiast listy
    path: 'favorites',
    canActivate: [roleGuard('CLIENT')],
    loadComponent: () => import('./favorites'),
  },
] satisfies Route[];
