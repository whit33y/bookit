import { Component } from '@angular/core';
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

const ROLE_LABELS: Record<UserRole, string> = {
  CLIENT: 'Klient',
  OWNER: 'Właściciel',
  EMPLOYEE: 'Pracownik',
  ADMIN: 'Administrator',
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
    AdminToolbar,
    Pagination,
    AdminStatusBadge,
    LoadingState,
    ErrorState,
    EmptyState,
  ],
  template: `
    <app-admin-toolbar
      class="mt-6 block"
      [q]="list.params().q"
      [blocked]="list.params().blocked"
      searchLabel="Szukaj użytkownika"
      searchPlaceholder="Imię, nazwisko lub e-mail"
      activeLabel="Aktywni"
      blockedLabel="Zablokowani"
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
          title="Ta strona nie ma już wyników."
          [boxed]="true"
        >
          <button
            type="button"
            class="btn-primary mt-4 w-auto"
            (click)="list.goToPage(1)"
          >
            Wróć na pierwszą stronę
          </button>
        </app-empty-state>
      } @else if (list.filtered()) {
        <app-empty-state
          class="mt-6"
          title="Brak użytkowników dla podanych filtrów."
          description="Zmień frazę wyszukiwania lub filtr statusu."
          [boxed]="true"
        />
      } @else {
        <app-empty-state class="mt-6" title="Nie ma jeszcze żadnych użytkowników." [boxed]="true" />
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
          aria-label="Tabela użytkowników"
        >
          <table class="w-full min-w-[820px] text-left text-sm">
            <caption class="sr-only">
              Lista użytkowników zarejestrowanych w serwisie
            </caption>
            <thead
              class="border-b border-stone-200 bg-stone-50 text-[11px] font-semibold uppercase tracking-wider text-stone-500"
            >
              <tr>
                <th scope="col" class="px-4 py-3 sm:px-6">Użytkownik</th>
                <th scope="col" class="px-4 py-3">Telefon</th>
                <th scope="col" class="px-4 py-3">Rola</th>
                <th scope="col" class="px-4 py-3">Firma</th>
                <th scope="col" class="px-4 py-3">Status</th>
                <th scope="col" class="px-4 py-3 sm:px-6">Dołączył</th>
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
                    {{ u.phone ?? '—' }}
                  </td>
                  <td class="px-4 py-3.5 text-stone-600">{{ roleLabels[u.role] }}</td>
                  <td class="px-4 py-3.5 text-stone-600">
                    @if (u.business; as business) {
                      {{ business.name }}
                      @if (business.isBlocked) {
                        <span class="block text-[13px] font-medium text-rose-600">
                          zablokowana
                        </span>
                      }
                    } @else {
                      —
                    }
                  </td>
                  <td class="px-4 py-3.5">
                    <app-admin-status-badge
                      [blocked]="u.isBlocked"
                      [label]="u.isBlocked ? 'Zablokowany' : 'Aktywny'"
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
          itemsLabel="użytkowników"
          (pageChange)="list.goToPage($event)"
        />
      </div>
    }
  `,
})
export default class AdminUsers {
  protected readonly list = createAdminList<AdminUser>('users');
  protected readonly roleLabels = ROLE_LABELS;
  protected readonly formatDate = formatDate;
}
