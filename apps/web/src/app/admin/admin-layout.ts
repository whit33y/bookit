import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { I18nStore } from '../core/i18n/i18n-store';
import { ACTIVE_LINK, INACTIVE_LINK } from '../shared/nav/nav-link-classes';

/** Wspólna ramka sekcji /admin: nagłówek + przełącznik tabel (#42). */
@Component({
  selector: 'app-admin-layout',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <div class="mx-auto w-full max-w-6xl px-4 py-8">
      <h1 class="text-xl font-bold tracking-tight sm:text-2xl">
        {{ i18n.t('admin.title') }}
      </h1>
      <p class="mt-1 text-sm text-stone-500">{{ i18n.t('admin.subtitle') }}</p>

      <nav
        [attr.aria-label]="i18n.t('admin.nav.sections')"
        class="mt-6 flex flex-wrap gap-1"
      >
        <a
          routerLink="businesses"
          routerLinkActive=""
          #businessesLink="routerLinkActive"
          [class]="businessesLink.isActive ? activeLink : inactiveLink"
          [attr.aria-current]="businessesLink.isActive ? 'page' : null"
        >
          {{ i18n.t('admin.nav.businesses') }}
        </a>
        <a
          routerLink="business-applications"
          routerLinkActive=""
          #applicationsLink="routerLinkActive"
          [class]="applicationsLink.isActive ? activeLink : inactiveLink"
          [attr.aria-current]="applicationsLink.isActive ? 'page' : null"
        >
          {{ i18n.t('admin.nav.applications') }}
        </a>
        <a
          routerLink="users"
          routerLinkActive=""
          #usersLink="routerLinkActive"
          [class]="usersLink.isActive ? activeLink : inactiveLink"
          [attr.aria-current]="usersLink.isActive ? 'page' : null"
        >
          {{ i18n.t('admin.nav.users') }}
        </a>
      </nav>

      <router-outlet />
    </div>
  `,
})
export default class AdminLayout {
  protected readonly i18n = inject(I18nStore);
  protected readonly activeLink = ACTIVE_LINK;
  protected readonly inactiveLink = INACTIVE_LINK;
}
