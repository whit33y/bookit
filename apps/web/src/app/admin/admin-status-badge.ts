import { Component, input } from '@angular/core';

// design system §5 — odcień 700 na tle 50 trzyma kontrast AA; kolor nigdy nie jest jedynym
// nośnikiem informacji, obok zawsze stoi tekst
const BLOCKED = 'bg-rose-50 text-rose-700 ring-rose-600/20';
const ACTIVE = 'bg-emerald-50 text-emerald-700 ring-emerald-600/20';

/** Badge statusu blokady. Etykietę podaje rodzic — po polsku odmienia się przez rodzaj
 *  („firma zablokowana", „użytkownik zablokowany"), a badge zna tylko warstwę wizualną. */
@Component({
  selector: 'app-admin-status-badge',
  template: `
    <span
      class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset"
      [class]="blocked() ? blockedClasses : activeClasses"
    >
      <span
        aria-hidden="true"
        class="h-1.5 w-1.5 rounded-full"
        [class]="blocked() ? 'bg-rose-500' : 'bg-emerald-500'"
      ></span>
      {{ label() }}
    </span>
  `,
})
export default class AdminStatusBadge {
  readonly blocked = input.required<boolean>();
  readonly label = input.required<string>();

  protected readonly blockedClasses = BLOCKED;
  protected readonly activeClasses = ACTIVE;
}
