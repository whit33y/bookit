import { Component } from '@angular/core';
import { formatDate } from '../shared/business-time';
import { createAdminList } from './admin-list';
import AdminPagination from './admin-pagination';
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
  imports: [AdminToolbar, AdminPagination, AdminStatusBadge],
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
      <p class="py-16 text-center text-sm text-stone-500" role="status">Ładowanie…</p>
    } @else if (list.serverError(); as msg) {
      <p role="alert" class="alert-danger mt-6">{{ msg }}</p>
    } @else if (list.items().length === 0) {
      <div
        class="mt-6 rounded-xl border border-stone-200 bg-stone-50 p-8 text-center"
      >
        @if (list.params().page) {
          <!-- paginacja renderuje się tylko przy niepustej liście — bez tego przycisku
               strona poza zakresem byłaby ślepym zaułkiem -->
          <p class="font-medium">Ta strona nie ma już wyników.</p>
          <button
            type="button"
            class="btn-primary mt-4 w-auto"
            (click)="list.goToPage(1)"
          >
            Wróć na pierwszą stronę
          </button>
        } @else if (list.filtered()) {
          <p class="font-medium">Brak użytkowników dla podanych filtrów.</p>
          <p class="mt-1 text-sm text-stone-500">
            Zmień frazę wyszukiwania lub filtr statusu.
          </p>
        } @else {
          <p class="font-medium">Nie ma jeszcze żadnych użytkowników.</p>
        }
      </div>
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

        <app-admin-pagination
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
