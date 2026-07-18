import { Route } from '@angular/router';

export default [
  { path: '', loadComponent: () => import('./my-bookings') },
] satisfies Route[];
