import { Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient, isApiStatus } from '../core/api-client';
import { I18nStore } from '../core/i18n/i18n-store';
import { translate } from '../core/i18n/translate';
import { formatDate } from '../shared/business-time';
import ConfirmDialog from '../shared/confirm-dialog';
import EmptyState from '../shared/ui/empty-state';
import ErrorState from '../shared/ui/error-state';
import LoadingState from '../shared/ui/loading-state';
import Pagination from '../shared/ui/pagination';
import { AdminBusiness } from './admin-businesses';
import { createAdminList } from './admin-list';
import { createRowActions } from './admin-row-actions';
import RejectApplicationDialog from './reject-application-dialog';

/** Zgłoszenie firmy — kształt `adminApplicationSelect` z apps/api/src/app/admin/admin.service.ts.
 *  To ten sam wiersz co w rejestrze firm, plus pola decyzji; kolejka pokazuje wyłącznie
 *  PENDING, więc `status` i `rejectionReason` nie mają tu czego wyświetlać — są w typie,
 *  bo odpowiedzi akcji zwracają rozpatrzone zgłoszenie. */
export interface AdminApplication extends AdminBusiness {
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason: string | null;
}

/** Zgłoszenie czekające na decyzję w otwartym modalu. */
interface PendingDecision {
  id: string;
  name: string;
  /** 'approve' albo 'reject' — decyduje, który modal jest otwarty i który endpoint leci. */
  action: 'approve' | 'reject';
}

/**
 * Kolejka zgłoszeń firm (#145): lista zgłoszeń czekających na decyzję administratora, osobno
 * od rejestru firm (`/admin/businesses`) — kolejka jest pracą do wykonania i ma się wyzerować,
 * rejestr służy przeglądaniu.
 *
 * Świadomie bez paska filtrów: decyzja dotyczy każdego wiersza po kolei, więc nie ma czego
 * zawężać. Stąd `createAdminList(..., { filters: false })` — kolejka zna z URL-a tylko `page`.
 *
 * Po decyzji wiersz znika z listy (`removeItem`), a nie zmienia status w miejscu: rozpatrzone
 * zgłoszenie nie należy już do kolejki i zostawione w tabeli przeczyłoby jej definicji.
 */
@Component({
  selector: 'app-admin-business-applications',
  imports: [
    Pagination,
    ConfirmDialog,
    RejectApplicationDialog,
    LoadingState,
    ErrorState,
    EmptyState,
  ],
  template: `
    <!-- zniknięcie wiersza jest nieme dla czytnika ekranu — ogłaszamy decyzję osobno -->
    <p class="sr-only" role="status">{{ actions.statusMessage() }}</p>

    @if (staleMessage(); as msg) {
      <!-- wiersz zniknął nie dlatego, że admin zdecydował: bez tego zdania kolejka po prostu
           „gubi" zgłoszenie w reakcji na jego klik -->
      <p role="alert" class="alert-danger mt-6">{{ msg }}</p>
    }

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
             strona poza zakresem byłaby ślepym zaułkiem (zakładka, „wstecz", ostatnia
             decyzja opróżniająca dalszą stronę) -->
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
      } @else {
        <app-empty-state
          class="mt-6"
          [title]="i18n.t('admin.applications.empty')"
          [description]="i18n.t('admin.applications.emptyHint')"
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
          [attr.aria-label]="i18n.t('admin.applications.tableLabel')"
        >
          <table class="w-full min-w-[820px] text-left text-sm">
            <caption class="sr-only">
              {{ i18n.t('admin.applications.caption') }}
            </caption>
            <thead
              class="border-b border-stone-200 bg-stone-50 text-[11px] font-semibold uppercase tracking-wider text-stone-500"
            >
              <tr>
                <th scope="col" class="px-4 py-3 sm:px-6">
                  {{ i18n.t('admin.applications.column.application') }}
                </th>
                <th scope="col" class="px-4 py-3">
                  {{ i18n.t('admin.applications.column.owner') }}
                </th>
                <th scope="col" class="px-4 py-3">
                  {{ i18n.t('admin.applications.column.submitted') }}
                </th>
                <th scope="col" class="px-4 py-3 sm:px-6">
                  <span class="sr-only">{{
                    i18n.t('admin.applications.column.actions')
                  }}</span>
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-stone-100">
              @for (a of list.items(); track a.id) {
                <tr class="transition hover:bg-stone-50">
                  <td class="px-4 py-3.5 sm:px-6">
                    <span class="font-semibold">{{ a.name }}</span>
                    <span class="block text-[13px] text-stone-500">
                      {{
                        i18n.t('admin.applications.meta', {
                          category: a.category.name,
                          city: a.city,
                          street: a.street,
                        })
                      }}
                    </span>
                  </td>
                  <td class="px-4 py-3.5">
                    <span class="font-medium">
                      {{ a.owner.firstName }} {{ a.owner.lastName }}
                    </span>
                    <span class="block text-[13px] text-stone-500">
                      {{ a.owner.email }}
                    </span>
                  </td>
                  <td class="px-4 py-3.5 tabular-nums text-stone-600">
                    {{ formatDate(a.createdAt) }}
                  </td>
                  <td class="px-4 py-3.5 sm:px-6">
                    <div class="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        [disabled]="actions.isBusy(a.id)"
                        [attr.aria-label]="
                          i18n.t('admin.applications.approveAria', { name: a.name })
                        "
                        (click)="onRequestDecision(a, 'approve')"
                        class="rounded-lg border border-emerald-300 px-3.5 py-1.5 text-[13px] font-semibold text-emerald-700 transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:opacity-60"
                      >
                        {{ i18n.t('admin.applications.approve') }}
                      </button>
                      <button
                        type="button"
                        [disabled]="actions.isBusy(a.id)"
                        [attr.aria-label]="
                          i18n.t('admin.applications.rejectAria', { name: a.name })
                        "
                        (click)="onRequestDecision(a, 'reject')"
                        class="rounded-lg border border-rose-300 px-3.5 py-1.5 text-[13px] font-semibold text-rose-700 transition hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2 disabled:opacity-60"
                      >
                        {{ i18n.t('admin.applications.reject') }}
                      </button>
                    </div>
                    @if (rowError(a.id); as msg) {
                      <span
                        role="alert"
                        class="mt-1.5 block text-right text-[13px] font-medium text-rose-600"
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
          [itemsLabel]="i18n.t('admin.applications.itemsLabel')"
          (pageChange)="list.goToPage($event)"
        />
      </div>
    }

    <app-confirm-dialog
      [open]="approving() !== null"
      [heading]="i18n.t('admin.applications.dialog.approveHeading')"
      [message]="approveMessage()"
      [confirmLabel]="i18n.t('admin.applications.dialog.approveConfirm')"
      [busyLabel]="i18n.t('admin.applications.dialog.approveBusy')"
      tone="primary"
      [busy]="decisionBusy()"
      (confirmed)="onConfirmApprove()"
      (cancelled)="pendingDecision.set(null)"
    />

    <app-reject-application-dialog
      [open]="rejecting() !== null"
      [businessName]="rejecting()?.name ?? ''"
      [busy]="decisionBusy()"
      [serverError]="dialogError()"
      (submitted)="onSubmitReject($event)"
      (cancelled)="pendingDecision.set(null)"
    />
  `,
})
export default class AdminBusinessApplications {
  private readonly api = inject(ApiClient);
  protected readonly i18n = inject(I18nStore);

  protected readonly list = createAdminList<AdminApplication>(
    'business-applications',
    { filters: false },
  );
  protected readonly formatDate = formatDate;

  protected readonly pendingDecision = signal<PendingDecision | null>(null);
  protected readonly actions = createRowActions();
  /** Komunikat nad tabelą po decyzji, która zapadła gdzie indziej (404/409) — wiersza,
   *  do którego można by go przypiąć, już w kolejce nie ma. */
  protected readonly staleMessage = signal('');

  protected readonly approving = computed(() =>
    this.pendingDecision()?.action === 'approve' ? this.pendingDecision() : null,
  );
  protected readonly rejecting = computed(() =>
    this.pendingDecision()?.action === 'reject' ? this.pendingDecision() : null,
  );

  protected readonly decisionBusy = computed(() => {
    const pending = this.pendingDecision();
    return pending !== null && this.actions.isBusy(pending.id);
  });

  protected readonly approveMessage = computed(() => {
    const pending = this.approving();
    return pending
      ? translate('admin.applications.dialog.approveMessage', { name: pending.name })
      : '';
  });

  /** Błąd nieudanego odrzucenia zostaje w modalu, bo ten pozostaje otwarty z wpisanym
   *  powodem — admin ma go ponowić, a nie przepisywać od nowa nad zniknięty formularz. */
  protected readonly dialogError = computed(() => {
    const pending = this.rejecting();
    return pending ? this.actions.errorFor(pending.id) : null;
  });

  protected rowError(id: string): string | null {
    // ten sam błąd pokazuje modal odrzucenia — w wierszu byłby wtedy podwójny
    return this.dialogError() === null ? this.actions.errorFor(id) : null;
  }

  protected onRequestDecision(
    application: AdminApplication,
    action: PendingDecision['action'],
  ): void {
    this.actions.clearError();
    this.staleMessage.set('');
    this.pendingDecision.set({ id: application.id, name: application.name, action });
  }

  protected onConfirmApprove(): void {
    void this.decide('approve');
  }

  protected onSubmitReject(reason: string): void {
    void this.decide('reject', { reason });
  }

  private async decide(
    action: PendingDecision['action'],
    // puste dla akceptacji, `{ reason }` dla odrzucenia — kształt pilnuje RejectApplicationDto
    body: object = {},
  ): Promise<void> {
    const pending = this.pendingDecision();
    if (!pending || pending.action !== action) {
      return;
    }

    const result = await this.actions.run(pending.id, async () => {
      // odpowiedź to rozpatrzone zgłoszenie — nie potrzebujemy z niej nic poza nazwą do
      // komunikatu, bo wiersz i tak wypada z kolejki
      const decided = await firstValueFrom(
        this.api.post<AdminApplication>(
          `/admin/business-applications/${pending.id}/${action}`,
          body,
        ),
      );
      this.list.removeItem(decided.id);
      return translate(
        action === 'approve'
          ? 'admin.applications.approvedMessage'
          : 'admin.applications.rejectedMessage',
        { name: decided.name },
      );
    });

    if (result.ok) {
      this.pendingDecision.set(null);
      return;
    }

    // 404 („Nie znaleziono zgłoszenia") i 409 („Zgłoszenie zostało już rozpatrzone") nie są
    // „spróbuj ponownie": w obu decyzja zapadła gdzie indziej (drugi admin, wycofane
    // zgłoszenie), więc w kolejce nie ma już czego rozpatrywać i wiersz z niej wypada —
    // inaczej kolejka nigdy by się nie wyzerowała, a każde ponowienie wracało tym samym błędem
    if (isApiStatus(result.error, 404, 409)) {
      this.actions.clearError();
      this.list.removeItem(pending.id);
      this.staleMessage.set(
        translate('admin.applications.staleMessage', { name: pending.name }),
      );
      this.pendingDecision.set(null);
      return;
    }

    this.closeApproveIfStillPending(pending.id);
  }

  /** Akceptacja nieudana z powodu, który da się ponowić (awaria sieci, 500), zamyka modal
   *  i pokazuje błąd w wierszu — w modalu nie ma czego poprawić, w odróżnieniu od odrzucenia,
   *  którego modal zostaje z wpisanym powodem. Warunek na id pilnuje, że nie zamykamy modala
   *  otwartego w trakcie zapytania dla innego wiersza. */
  private closeApproveIfStillPending(id: string): void {
    const pending = this.pendingDecision();
    if (pending?.id === id && pending.action === 'approve') {
      this.pendingDecision.set(null);
    }
  }
}
