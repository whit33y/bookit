import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

// pigułki nawigacji wg design systemu §10 — rozdzielone, bo [class] podmienia cały zestaw
// zamiast nakładać klasy na siebie (dwie konkurujące klasy text-* zależałyby od kolejności w CSS)
const ACTIVE_LINK = 'bg-brand-50 font-semibold text-brand-700';
const INACTIVE_LINK = 'font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900';

/** Wspólna ramka sekcji /admin: nagłówek + przełącznik tabel (#42). */
@Component({
  selector: 'app-admin-layout',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <div class="mx-auto w-full max-w-6xl px-4 py-8">
      <h1 class="text-xl font-bold tracking-tight sm:text-2xl">
        Panel administratora
      </h1>
      <p class="mt-1 text-sm text-stone-500">
        Przeglądaj firmy i użytkowników, blokuj firmy naruszające zasady.
      </p>

      <nav aria-label="Sekcje panelu" class="mt-6 flex flex-wrap gap-1">
        <a
          routerLink="businesses"
          routerLinkActive=""
          #businessesLink="routerLinkActive"
          [class]="businessesLink.isActive ? activeLink : inactiveLink"
          [attr.aria-current]="businessesLink.isActive ? 'page' : null"
          class="rounded-lg px-3.5 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        >
          Firmy
        </a>
        <a
          routerLink="users"
          routerLinkActive=""
          #usersLink="routerLinkActive"
          [class]="usersLink.isActive ? activeLink : inactiveLink"
          [attr.aria-current]="usersLink.isActive ? 'page' : null"
          class="rounded-lg px-3.5 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        >
          Użytkownicy
        </a>
      </nav>

      <router-outlet />
    </div>
  `,
})
export default class AdminLayout {
  protected readonly activeLink = ACTIVE_LINK;
  protected readonly inactiveLink = INACTIVE_LINK;
}
