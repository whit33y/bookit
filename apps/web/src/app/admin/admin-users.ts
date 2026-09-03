import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18nStore } from '../core/i18n/i18n-store';
import type { TranslationKey } from '../core/i18n/pl';
import { formatDate } from '../shared/business-time';
import EmptyState from '../shared/ui/empty-state';
import ErrorState from '../shared/ui/error-state';
import LoadingState from '../shared/ui/loading-state';
import { createAdminList } from './admin-list';
import Pagination from '../shared/ui/pagination';
import AdminStatusBadge from './admin-status-badge';
import AdminToolbar from './admin-toolbar';

// lustrzane typy backendu — adminUserSelect w apps/api/src/app/admin/admin.service.ts
type UserRole = 'CLIENT' | 'OWNER' | 'EMPLOYEE' | 'ADMIN';

export interface AdminUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: UserRole;
  isBlocked: boolean;
  createdAt: string;
  business: { id: string; slug: string; name: string; isBlocked: boolean } | null;
}

const ROLE_KEYS: Record<UserRole, TranslationKey> = {
  CLIENT: 'admin.role.client',
  OWNER: 'admin.role.owner',
  EMPLOYEE: 'admin.role.employee',
  ADMIN: 'admin.role.admin',
};

/**
 * Lista użytkowników: wyszukiwanie, filtr blokady, paginacja (#42).
 *
 * Bez akcji na wierszu — API ma blokowanie wyłącznie dla firm (`POST /admin/businesses/:id/block`),
 * a flaga `isBlocked` użytkownika jest dziś ustawiana tylko po stronie bazy. Pokazujemy ją,
 * żeby admin widział, czemu ktoś nie może się zalogować.
 */
@Component({
  selector: 'app-admin-users',
  imports: [
    RouterLink,
    AdminToolbar,
    Pagination,
    AdminStatusBadge,
    LoadingState,
    ErrorState,
    EmptyState,
  ],
  template: `
    <a
      routerLink="/admin/users/new"
      class="mt-6 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-card transition hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
    >
      {{ i18n.t('admin.newAdmin.link') }}
    </a>

    <app-admin-toolbar
      class="mt-4 block"
      [q]="list.params().q"
      [blocked]="list.params().blocked"
      [searchLabel]="i18n.t('admin.users.searchLabel')"
      [searchPlaceholder]="i18n.t('admin.users.searchPlaceholder')"
      [activeLabel]="i18n.t('admin.users.active')"
      [blockedLabel]="i18n.t('admin.users.blocked')"
      (applied)="list.applyFilters($event)"
    />

    @if (list.loading()) {
      <app-loading-state paddingClass="py-16 text-center" />
    } @else if (list.serverError(); as msg) {
      <app-error-state
        class="mt-6"
        [message]="msg"
        [retryable]="true"
        (retry)="list.reload()"
      />
    } @else if (list.items().length === 0) {
      @if (list.params().page) {
        <!-- paginacja renderuje się tylko przy niepustej liście — bez tego przycisku
             strona poza zakresem byłaby ślepym zaułkiem -->
        <app-empty-state
          class="mt-6"
          [title]="i18n.t('admin.emptyPage')"
          [boxed]="true"
        >
          <button
            type="button"
            class="btn-primary mt-4 w-auto"
            (click)="list.goToPage(1)"
          >
            {{ i18n.t('admin.backToFirstPage') }}
          </button>
        </app-empty-state>
      } @else if (list.filtered()) {
        <app-empty-state
          class="mt-6"
          [title]="i18n.t('admin.users.emptyFiltered')"
          [description]="i18n.t('admin.users.emptyFilteredHint')"
          [boxed]="true"
        />
      } @else {
        <app-empty-state
          class="mt-6"
          [title]="i18n.t('admin.users.empty')"
          [boxed]="true"
        />
      }
    } @else {
      <div
        class="mt-6 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-card"
      >
        <!-- fokusowalny kontener przewijania — bez tego klawiatura nie doscrolluje tabeli
             szerszej niż ekran (AXE: scrollable-region-focusable) -->
        <div
          class="overflow-x-auto"
          tabindex="0"
          role="region"
          [attr.aria-label]="i18n.t('admin.users.tableLabel')"
        >
          <table class="w-full min-w-[820px] text-left text-sm">
            <caption class="sr-only">
              {{ i18n.t('admin.users.caption') }}
            </caption>
            <thead
              class="border-b border-stone-200 bg-stone-50 text-[11px] font-semibold uppercase tracking-wider text-stone-500"
            >
              <tr>
                <th scope="col" class="px-4 py-3 sm:px-6">
                  {{ i18n.t('admin.users.column.user') }}
                </th>
                <th scope="col" class="px-4 py-3">
                  {{ i18n.t('admin.users.column.phone') }}
                </th>
                <th scope="col" class="px-4 py-3">
                  {{ i18n.t('admin.users.column.role') }}
                </th>
                <th scope="col" class="px-4 py-3">
                  {{ i18n.t('admin.users.column.business') }}
                </th>
                <th scope="col" class="px-4 py-3">
                  {{ i18n.t('admin.users.column.status') }}
                </th>
                <th scope="col" class="px-4 py-3 sm:px-6">
                  {{ i18n.t('admin.users.column.joined') }}
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-stone-100">
              @for (u of list.items(); track u.id) {
                <tr class="transition hover:bg-stone-50">
                  <td class="px-4 py-3.5 sm:px-6">
                    <span class="font-semibold">
                      {{ u.firstName }} {{ u.lastName }}
                    </span>
                    <span class="block text-[13px] text-stone-500">{{ u.email }}</span>
                  </td>
                  <td class="px-4 py-3.5 tabular-nums text-stone-600">
                    {{ u.phone ?? i18n.t('admin.noValue') }}
                  </td>
                  <td class="px-4 py-3.5 text-stone-600">
                    {{ i18n.t(roleKeys[u.role]) }}
                  </td>
                  <td class="px-4 py-3.5 text-stone-600">
                    @if (u.business; as business) {
                      {{ business.name }}
                      @if (business.isBlocked) {
                        <span class="block text-[13px] font-medium text-rose-600">
                          {{ i18n.t('admin.users.businessBlocked') }}
                        </span>
                      }
                    } @else {
                      {{ i18n.t('admin.noValue') }}
                    }
                  </td>
                  <td class="px-4 py-3.5">
                    <app-admin-status-badge
                      [blocked]="u.isBlocked"
                      [label]="
                        u.isBlocked
                          ? i18n.t('admin.users.badge.blocked')
                          : i18n.t('admin.users.badge.active')
                      "
                    />
                  </td>
                  <td class="px-4 py-3.5 tabular-nums text-stone-600 sm:px-6">
                    {{ formatDate(u.createdAt) }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <app-pagination
          [page]="list.page()"
          [limit]="list.limit()"
          [total]="list.total()"
          [itemsLabel]="i18n.t('admin.users.itemsLabel')"
          (pageChange)="list.goToPage($event)"
        />
      </div>
    }
  `,
})
export default class AdminUsers {
  protected readonly i18n = inject(I18nStore);
  protected readonly list = createAdminList<AdminUser>('users');
  protected readonly roleKeys = ROLE_KEYS;
  protected readonly formatDate = formatDate;
}
