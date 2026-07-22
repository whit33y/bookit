import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink],
  template: `
    <div class="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center">
      <p class="text-sm font-semibold uppercase tracking-wider text-brand-700">404</p>
      <h1 class="mt-2 text-2xl font-bold tracking-tight">Nie znaleziono strony</h1>
      <p class="mt-2 max-w-md text-sm text-stone-500">
        Strona, której szukasz, nie istnieje lub została przeniesiona.
      </p>
      <a routerLink="/" class="btn-primary mt-6">Wróć na stronę główną</a>
    </div>
  `,
})
export default class NotFound {}
