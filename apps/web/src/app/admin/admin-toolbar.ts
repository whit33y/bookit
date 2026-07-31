import { Component, input, linkedSignal, output } from '@angular/core';
import { BlockedFilter, MAX_QUERY_LENGTH } from './admin-list-params';

export interface AdminFilters {
  q: string;
  blocked: BlockedFilter;
}

/**
 * Pasek filtrów nad tabelami admina: wyszukiwanie po frazie + filtr blokady.
 *
 * Świadomie bez debounce'u — filtry zapisują się do URL, a wyszukiwanie na każde naciśnięcie
 * klawisza zasypywałoby historię przeglądarki wpisami i backend zapytaniami. Submit formularza
 * (Enter lub „Szukaj") daje jeden przewidywalny moment zmiany, spójny z resztą aplikacji.
 */
@Component({
  selector: 'app-admin-toolbar',
  template: `
    <form
      class="flex flex-col gap-3 sm:flex-row sm:items-end"
      novalidate
      (submit)="onSubmit($event)"
    >
      <div class="flex-1">
        <label for="admin-search" class="mb-1.5 block text-sm font-medium">
          {{ searchLabel() }}
        </label>
        <input
          id="admin-search"
          type="search"
          name="q"
          [attr.maxlength]="maxQueryLength"
          [value]="draftQ()"
          [placeholder]="searchPlaceholder()"
          (input)="onQueryInput($event)"
          class="w-full rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm placeholder-stone-400 shadow-card transition focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-ring"
        />
      </div>

      <div class="sm:w-52">
        <label for="admin-status" class="mb-1.5 block text-sm font-medium">
          Status
        </label>
        <select
          id="admin-status"
          name="blocked"
          [value]="draftBlocked() ?? ''"
          (change)="onBlockedChange($event)"
          class="w-full rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm shadow-card transition focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-ring"
        >
          <option value="">Wszystkie</option>
          <option value="false">{{ activeLabel() }}</option>
          <option value="true">{{ blockedLabel() }}</option>
        </select>
      </div>

      <div class="flex gap-2">
        <button type="submit" class="btn-primary w-auto">Szukaj</button>
        @if (hasFilters()) {
          <button
            type="button"
            (click)="onReset()"
            class="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium shadow-card transition hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          >
            Wyczyść
          </button>
        }
      </div>
    </form>
  `,
})
export default class AdminToolbar {
  readonly q = input('');
  readonly blocked = input<BlockedFilter>(null);
  readonly searchLabel = input.required<string>();
  readonly searchPlaceholder = input('');
  // etykiety filtra podaje rodzic — po polsku odmieniają się przez rodzaj: firmy są
  // „aktywne", a użytkownicy „aktywni" (ten sam powód co w admin-status-badge.ts)
  readonly activeLabel = input.required<string>();
  readonly blockedLabel = input.required<string>();

  readonly applied = output<AdminFilters>();

  protected readonly maxQueryLength = MAX_QUERY_LENGTH;

  // linkedSignal, nie signal: pola to bufor edycji, ale muszą wrócić do stanu z URL-a, gdy ten
  // zmieni się z zewnątrz (przycisk „wstecz", klik w „Wyczyść", wejście z linku)
  protected readonly draftQ = linkedSignal(() => this.q());
  protected readonly draftBlocked = linkedSignal(() => this.blocked());

  protected hasFilters(): boolean {
    return this.q().length > 0 || this.blocked() !== null;
  }

  protected onQueryInput(event: Event): void {
    this.draftQ.set((event.target as HTMLInputElement).value);
  }

  protected onBlockedChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.draftBlocked.set(value === 'true' || value === 'false' ? value : null);
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    this.applied.emit({ q: this.draftQ().trim(), blocked: this.draftBlocked() });
  }

  protected onReset(): void {
    this.applied.emit({ q: '', blocked: null });
  }
}
