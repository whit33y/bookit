import { Route } from '@angular/router';
import { roleGuard } from '../core/auth/auth.guard';

export default [
  { path: '', loadComponent: () => import('./dashboard') },
  {
    // rodzic „business" wpuszcza też EMPLOYEE — ustawienia firmy tylko dla OWNER
    path: 'settings',
    canActivate: [roleGuard('OWNER')],
    loadComponent: () => import('./settings/settings'),
  },
  {
    // panel usług tylko dla OWNER (backend @Roles(OWNER))
    path: 'services',
    canActivate: [roleGuard('OWNER')],
    loadComponent: () => import('./services/services'),
  },
] satisfies Route[];
