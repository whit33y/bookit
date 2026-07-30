import { Route } from '@angular/router';
import { roleGuard } from '../core/auth/auth.guard';

export default [
  { path: '', loadComponent: () => import('./dashboard') },
  {
    // kalendarz wspólny dla OWNER i EMPLOYEE — kto widzi kolumny/wybór pracownika,
    // rozstrzyga rola wewnątrz komponentu (#32)
    path: 'calendar',
    loadComponent: () => import('./calendar/calendar'),
  },
  {
    // lista PENDING wspólna dla OWNER i EMPLOYEE — akcje (akceptuj/odrzuć/odwołaj) tylko
    // dla OWNER, rozstrzyga rola wewnątrz komponentu, jak w kalendarzu (#33)
    path: 'pending',
    loadComponent: () => import('./pending/pending-bookings'),
  },
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
  {
    // panel pracowników tylko dla OWNER (backend @Roles(OWNER))
    path: 'employees',
    canActivate: [roleGuard('OWNER')],
    loadComponent: () => import('./employees/employees'),
  },
  {
    // edytor grafiku + urlopów pracownika, tylko OWNER (backend @Roles(OWNER))
    path: 'employees/:id/schedule',
    canActivate: [roleGuard('OWNER')],
    loadComponent: () => import('./employees/schedule/schedule'),
  },
] satisfies Route[];
