import { Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient, apiErrorMessage } from '../core/api-client';
import { I18nStore } from '../core/i18n/i18n-store';
import { translate } from '../core/i18n/translate';
import { formatDate } from '../shared/business-time';
import ConfirmDialog from '../shared/confirm-dialog';
import EmptyState from '../shared/ui/empty-state';
import ErrorState from '../shared/ui/error-state';
import LoadingState from '../shared/ui/loading-state';
import { createAdminList } from './admin-list';
import Pagination from '../shared/ui/pagination';
import AdminStatusBadge from './admin-status-badge';
import AdminToolbar from './admin-toolbar';

// lustrzane typy backendu — adminBusinessSelect w apps/api/src/app/admin/admin.service.ts
export interface AdminBusiness {
  id: string;
  slug: string;
  name: string;
  city: string;
  street: string;
  isBlocked: boolean;
  createdAt: string;
  updatedAt: string;
  category: { id: string; name: string; slug: string };
  owner: { id: string; email: string; firstName: string; lastName: string };
  _count: { services: number; employees: number; bookings: number };
}

/** Firma czekająca na potwierdzenie akcji w modalu. */
interface PendingAction {
  id: string;
  name: string;
  /** true = blokujemy, false = odblokowujemy. */
  block: boolean;
}

/** Lista firm z moderacją: wyszukiwanie, filtr blokady, paginacja, blokuj/odblokuj (#42). */
@Component({
  selector: 'app-admin-businesses',
  imports: [
    AdminToolbar,
    Pagination,
    AdminStatusBadge,
    ConfirmDialog,
    LoadingState,
    ErrorState,
    EmptyState,
  ],
  template: `
    <app-admin-toolbar
      class="mt-6 block"
      [q]="list.params().q"
      [blocked]="list.params().blocked"
      [searchLabel]="i18n.t('admin.businesses.searchLabel')"
      [searchPlaceholder]="i18n.t('admin.businesses.searchPlaceholder')"
      [activeLabel]="i18n.t('admin.businesses.active')"
      [blockedLabel]="i18n.t('admin.businesses.blocked')"
      (applied)="list.applyFilters($event)"
    />

    <!-- zmiana badge'a w wierszu jest niema dla czytnika ekranu — ogłaszamy ją osobno -->
    <p class="sr-only" role="status">{{ statusMessage() }}</p>

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
        <!-- paginacja renderuje się tylko przy niepustej liście, więc bez tego wyjścia
             strona poza zakresem byłaby ślepym zaułkiem (zakładka, „wstecz") -->
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
          [title]="i18n.t('admin.businesses.emptyFiltered')"
          [description]="i18n.t('admin.businesses.emptyFilteredHint')"
          [boxed]="true"
        />
      } @else {
        <app-empty-state
          class="mt-6"
          [title]="i18n.t('admin.businesses.empty')"
          [boxed]="true"
        />
      }
    } @else {
      <div
        class="mt-6 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-card"
      >
        <!-- tabela jest szersza niż telefon: kontener musi być fokusowalny, żeby dało się
             go przewinąć klawiaturą (AXE: scrollable-region-focusable) -->
        <div
          class="overflow-x-auto"
          tabindex="0"
          role="region"
          [attr.aria-label]="i18n.t('admin.businesses.tableLabel')"
        >
          <table class="w-full min-w-[900px] text-left text-sm">
            <caption class="sr-only">
              {{ i18n.t('admin.businesses.caption') }}
            </caption>
            <thead
              class="border-b border-stone-200 bg-stone-50 text-[11px] font-semibold uppercase tracking-wider text-stone-500"
            >
              <tr>
                <th scope="col" class="px-4 py-3 sm:px-6">
                  {{ i18n.t('admin.businesses.column.business') }}
                </th>
                <th scope="col" class="px-4 py-3">
                  {{ i18n.t('admin.businesses.column.owner') }}
                </th>
                <th scope="col" class="px-4 py-3 text-right">
                  {{ i18n.t('admin.businesses.column.services') }}
                </th>
                <th scope="col" class="px-4 py-3 text-right">
                  {{ i18n.t('admin.businesses.column.employees') }}
                </th>
                <th scope="col" class="px-4 py-3 text-right">
                  {{ i18n.t('admin.businesses.column.bookings') }}
                </th>
                <th scope="col" class="px-4 py-3">
                  {{ i18n.t('admin.businesses.column.status') }}
                </th>
                <th scope="col" class="px-4 py-3">
                  {{ i18n.t('admin.businesses.column.added') }}
                </th>
                <th scope="col" class="px-4 py-3 sm:px-6">
                  <span class="sr-only">{{
                    i18n.t('admin.businesses.column.actions')
                  }}</span>
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-stone-100">
              @for (b of list.items(); track b.id) {
                <tr class="transition hover:bg-stone-50">
                  <td class="px-4 py-3.5 sm:px-6">
                    <span class="font-semibold">{{ b.name }}</span>
                    <span class="block text-[13px] text-stone-500">
                      {{
                        i18n.t('admin.businesses.meta', {
                          category: b.category.name,
                          city: b.city,
                          street: b.street,
                        })
                      }}
                    </span>
                  </td>
                  <td class="px-4 py-3.5">
                    <span class="font-medium">
                      {{ b.owner.firstName }} {{ b.owner.lastName }}
                    </span>
                    <span class="block text-[13px] text-stone-500">
                      {{ b.owner.email }}
                    </span>
                  </td>
                  <td class="px-4 py-3.5 text-right tabular-nums text-stone-600">
                    {{ b._count.services }}
                  </td>
                  <td class="px-4 py-3.5 text-right tabular-nums text-stone-600">
                    {{ b._count.employees }}
                  </td>
                  <td class="px-4 py-3.5 text-right tabular-nums text-stone-600">
                    {{ b._count.bookings }}
                  </td>
                  <td class="px-4 py-3.5">
                    <app-admin-status-badge
                      [blocked]="b.isBlocked"
                      [label]="
                        b.isBlocked
                          ? i18n.t('admin.businesses.badge.blocked')
                          : i18n.t('admin.businesses.badge.active')
                      "
                    />
                  </td>
                  <td class="px-4 py-3.5 tabular-nums text-stone-600">
                    {{ formatDate(b.createdAt) }}
                  </td>
                  <td class="px-4 py-3.5 text-right sm:px-6">
                    <button
                      type="button"
                      [disabled]="isBusy(b.id)"
                      [attr.aria-label]="
                        b.isBlocked
                          ? i18n.t('admin.businesses.unblockAria', { name: b.name })
                          : i18n.t('admin.businesses.blockAria', { name: b.name })
                      "
                      (click)="onRequestToggle(b)"
                      class="rounded-lg border px-3.5 py-1.5 text-[13px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-60"
                      [class]="
                        b.isBlocked
                          ? 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50 focus-visible:ring-brand-600'
                          : 'border-rose-300 text-rose-700 hover:bg-rose-50 focus-visible:ring-rose-600'
                      "
                    >
                      {{
                        b.isBlocked
                          ? i18n.t('admin.businesses.unblock')
                          : i18n.t('admin.businesses.block')
                      }}
                    </button>
                    @if (errorFor(b.id); as msg) {
                      <span
                        role="alert"
                        class="mt-1.5 block text-[13px] font-medium text-rose-600"
                      >
                        {{ msg }}
                      </span>
                    }
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
          [itemsLabel]="i18n.t('admin.businesses.itemsLabel')"
          (pageChange)="list.goToPage($event)"
        />
      </div>
    }

    <app-confirm-dialog
      [open]="pendingAction() !== null"
      [heading]="dialogHeading()"
      [message]="dialogMessage()"
      [confirmLabel]="dialogConfirmLabel()"
      [busyLabel]="dialogBusyLabel()"
      [tone]="pendingAction()?.block ? 'danger' : 'primary'"
      [busy]="dialogBusy()"
      (confirmed)="onConfirm()"
      (cancelled)="pendingAction.set(null)"
    />
  `,
})
export default class AdminBusinesses {
  private readonly api = inject(ApiClient);
  protected readonly i18n = inject(I18nStore);

  protected readonly list = createAdminList<AdminBusiness>('businesses');
  protected readonly formatDate = formatDate;

  protected readonly pendingAction = signal<PendingAction | null>(null);
  protected readonly statusMessage = signal('');
  // błąd otagowany id firmy, żeby wyrenderować go w jej wierszu, a nie nad całą tabelą;
  // naraz może istnieć jeden — modal dopuszcza tylko jedną akcję w danym momencie
  private readonly actionError = signal<{ id: string; message: string } | null>(null);
  // zbiór, nie pojedyncze id: dwa wiersze mogą być w locie równolegle
  private readonly busy = signal<ReadonlySet<string>>(new Set());

  protected readonly dialogBusy = computed(() => {
    const pending = this.pendingAction();
    return pending !== null && this.busy().has(pending.id);
  });

  protected readonly dialogHeading = computed(() =>
    this.pendingAction()?.block
      ? translate('admin.businesses.dialog.blockHeading')
      : translate('admin.businesses.dialog.unblockHeading'),
  );

  protected readonly dialogMessage = computed(() => {
    const pending = this.pendingAction();
    if (!pending) {
      return '';
    }
    // pełne zdania, nie sklejanie czasownika w interpolacji: po polsku „została
    // zablokowana/odblokowana" odmienia się przez rodzaj, a po angielsku brzmi inaczej (#57)
    return pending.block
      ? translate('admin.businesses.dialog.blockMessage', { name: pending.name })
      : translate('admin.businesses.dialog.unblockMessage', { name: pending.name });
  });

  protected readonly dialogConfirmLabel = computed(() =>
    this.pendingAction()?.block
      ? translate('admin.businesses.dialog.blockConfirm')
      : translate('admin.businesses.dialog.unblockConfirm'),
  );

  protected readonly dialogBusyLabel = computed(() =>
    this.pendingAction()?.block
      ? translate('admin.businesses.dialog.blockBusy')
      : translate('admin.businesses.dialog.unblockBusy'),
  );

  protected isBusy(id: string): boolean {
    return this.busy().has(id);
  }

  protected errorFor(id: string): string | null {
    const error = this.actionError();
    return error?.id === id ? error.message : null;
  }

  protected onRequestToggle(business: AdminBusiness): void {
    this.actionError.set(null);
    this.pendingAction.set({
      id: business.id,
      name: business.name,
      block: !business.isBlocked,
    });
  }

  protected onConfirm(): void {
    void this.runAction();
  }

  private async runAction(): Promise<void> {
    const pending = this.pendingAction();
    if (!pending || this.isBusy(pending.id)) {
      return;
    }

    this.actionError.set(null);
    this.setBusy(pending.id, true);
    try {
      const action = pending.block ? 'block' : 'unblock';
      // odpowiedź to pełna firma w kształcie wiersza listy — backend zwraca ją właśnie po to,
      // żebyśmy podmienili wiersz bez ponownego GET-a (AC: status aktualizuje się od razu)
      const updated = await firstValueFrom(
        this.api.post<AdminBusiness>(
          `/admin/businesses/${pending.id}/${action}`,
          {},
        ),
      );
      const blockedFilter = this.list.params().blocked;
      if (blockedFilter !== null && String(updated.isBlocked) !== blockedFilter) {
        // lista pokazuje np. tylko zablokowane — odblokowana firma przestała do niej pasować
        // i zostawiona w tabeli przeczyłaby własnemu filtrowi (badge „Aktywna" wśród blokad)
        this.list.removeItem(updated.id);
      } else {
        this.list.replaceItem(updated);
      }
      this.statusMessage.set(
        updated.isBlocked
          ? translate('admin.businesses.blockedMessage', { name: updated.name })
          : translate('admin.businesses.unblockedMessage', { name: updated.name }),
      );
    } catch (err) {
      // 404 („Nie znaleziono firmy") trafia tu tak samo jak awaria sieci — w obu przypadkach
      // wiersz zostaje w dotychczasowym stanie, bo nic o nim nie wiemy na pewno
      this.actionError.set({ id: pending.id, message: apiErrorMessage(err) });
    } finally {
      this.setBusy(pending.id, false);
      this.closeIfStillPending(pending.id);
    }
  }

  /** Zamyka modal tylko wtedy, gdy wciąż dotyczy tej samej firmy — użytkownik mógł w trakcie
   *  zapytania zamknąć go Escape'em i otworzyć dla innego wiersza. */
  private closeIfStillPending(id: string): void {
    if (this.pendingAction()?.id === id) {
      this.pendingAction.set(null);
    }
  }

  private setBusy(id: string, value: boolean): void {
    this.busy.update((ids) => {
      const next = new Set(ids);
      if (value) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }
}
