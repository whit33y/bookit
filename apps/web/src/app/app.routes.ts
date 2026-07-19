import { Route } from '@angular/router';
import { authGuard, guestGuard, roleGuard } from './core/auth/auth.guard';

export const appRoutes: Route[] = [
  { path: '', loadComponent: () => import('./public/landing/landing') },
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
  { path: '**', redirectTo: '' },
];
