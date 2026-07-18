import { Route } from '@angular/router';

export default [
  { path: '', loadComponent: () => import('./dashboard') },
] satisfies Route[];
