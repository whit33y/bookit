import {
  Component,
  ElementRef,
  effect,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { I18nStore } from '../core/i18n/i18n-store';

/** Wariant przycisku potwierdzenia — `danger` dla akcji niszczących/odcinających dostęp. */
export type ConfirmTone = 'danger' | 'primary';

const TONE_CLASSES: Record<ConfirmTone, string> = {
  danger:
    'bg-rose-600 hover:bg-rose-700 focus-visible:ring-rose-600 disabled:bg-rose-300',
  primary:
    'bg-brand-700 hover:bg-brand-800 focus-visible:ring-brand-600 disabled:bg-stone-300',
};

/**
 * Modal potwierdzenia na natywnym `<dialog>` (design system §9). Escape, trap fokusu i powrót
 * fokusu do przycisku wywołującego dostajemy od przeglądarki — dlatego `<dialog>`, a nie div
 * z `role="dialog"`, który to wszystko musiałby odtwarzać ręcznie (FRONTEND_CLAUDE.md, WCAG AA).
 *
 * Sterowany jednym wejściem `open()`; rodzic trzyma stan i zamyka modal, ustawiając je na false.
 */
@Component({
  selector: 'app-confirm-dialog',
  template: `
    <!-- klik w tło zamyka modal — wygoda myszy, nie jedyna droga wyjścia (Escape działa natywnie) -->
    <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
    <dialog
      #dialog
      aria-labelledby="confirm-dialog-heading"
      aria-describedby="confirm-dialog-message"
      class="w-[min(28rem,92vw)] rounded-2xl border border-stone-200 p-0 shadow-raised backdrop:bg-stone-900/40 backdrop:backdrop-blur-[2px]"
      (cancel)="onCancelEvent($event)"
      (close)="onClose()"
      (click)="onBackdropClick($event)"
    >
      <div class="p-6 sm:p-7">
        <h2 id="confirm-dialog-heading" class="mb-2 text-lg font-bold">
          {{ heading() }}
        </h2>
        <p
          id="confirm-dialog-message"
          class="mb-6 text-sm leading-relaxed text-stone-600"
        >
          {{ message() }}
        </p>
        <div class="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            [disabled]="busy()"
            (click)="onCancelClick()"
            class="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 shadow-card transition hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60"
          >
            {{ cancelLabel() || i18n.t('confirm.cancel') }}
          </button>
          <button
            type="button"
            [disabled]="busy()"
            (click)="confirmed.emit()"
            class="rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-card transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed"
            [class]="toneClasses()"
          >
            {{ busy() ? busyLabel() || i18n.t('confirm.busy') : confirmLabel() }}
          </button>
        </div>
      </div>
    </dialog>
  `,
})
export default class ConfirmDialog {
  protected readonly i18n = inject(I18nStore);

  readonly open = input(false);
  readonly heading = input.required<string>();
  readonly message = input.required<string>();
  readonly confirmLabel = input.required<string>();
  /** Etykieta przycisku w trakcie zapytania, np. „Blokowanie…". Pusty domyślny, bo wartość
   *  domyślna `input()` powstaje raz i nie nadążyłaby za zmianą języka — fallback jest
   *  w szablonie (#57). To samo dotyczy `cancelLabel`. */
  readonly busyLabel = input('');
  readonly cancelLabel = input('');
  readonly tone = input<ConfirmTone>('danger');
  readonly busy = input(false);

  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  private readonly dialogEl =
    viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    // synchronizacja deklaratywnego open() z imperatywnym API <dialog>; showModal() tylko na
    // zamkniętym elemencie — powtórne wywołanie na otwartym rzuca InvalidStateError
    effect(() => {
      const dialog = this.dialogEl().nativeElement;
      if (this.open() && !dialog.open) {
        dialog.showModal();
      } else if (!this.open() && dialog.open) {
        dialog.close();
      }
    });
  }

  protected toneClasses(): string {
    return TONE_CLASSES[this.tone()];
  }

  protected onCancelClick(): void {
    this.dialogEl().nativeElement.close();
  }

  /** Escape w trakcie zapytania: gdyby modal się zamknął, rodzic uznałby akcję za anulowaną,
   *  a żądanie i tak by się dokończyło — użytkownik zobaczyłby efekt tego, co „odwołał". */
  protected onCancelEvent(event: Event): void {
    if (this.busy()) {
      event.preventDefault();
    }
  }

  protected onBackdropClick(event: MouseEvent): void {
    // <dialog> zajmuje cały viewport wraz z ::backdrop, więc klik w tło ma target == dialog
    if (event.target === this.dialogEl().nativeElement && !this.busy()) {
      this.dialogEl().nativeElement.close();
    }
  }

  protected onClose(): void {
    // (close) leci również wtedy, gdy to rodzic zamknął modal przez [open]="false" po udanej
    // akcji — wtedy nie ma czego anulować i emisja wprowadziłaby rodzica w błąd
    if (this.open()) {
      this.cancelled.emit();
    }
  }
}
