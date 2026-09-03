import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  FormField,
  disabled,
  form,
  maxLength,
  pattern,
  required,
  submit,
} from '@angular/forms/signals';
import { I18nStore } from '../core/i18n/i18n-store';
import { translate } from '../core/i18n/translate';

/** Lustro @MaxLength(500) z RejectApplicationDto (apps/api/src/app/admin/dto/reject-application.dto.ts).
 *  Bez tej reguły przekroczenie limitu wraca dopiero z serwera jako jeden ogólny błąd nad
 *  formularzem, a admin nie wie, o ile skrócić powód. */
const REASON_MAX_LENGTH = 500;

// lustro @Matches(/\S/) z tego samego DTO: samo "   " to niepusty string, ale po przycięciu
// w serwisie zostałby pusty powód — czyli dokładnie to, czego AC zabrania
const NON_BLANK = /\S/;

/**
 * Modal odrzucenia zgłoszenia firmy (#145): potwierdzenie decyzji **i** powód w jednym kroku.
 * Zbudowany jak `client/review-dialog.ts` na natywnym `<dialog>` (design system §9), bo
 * `shared/confirm-dialog.ts` nie ma pola do wpisania czegokolwiek, a powód jest tu wymagany —
 * odrzucenie bez powodu nie mówi zgłaszającemu, co poprawić.
 *
 * Komponent jest głupim widokiem: stan sieciowy (`busy`, `serverError`) trzyma rodzic,
 * a stąd wychodzi tylko `submitted` z przyciętym powodem.
 */
@Component({
  selector: 'app-reject-application-dialog',
  imports: [FormField],
  template: `
    <!-- klik w tło zamyka modal — wygoda myszy, nie jedyna droga wyjścia (Escape działa natywnie) -->
    <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
    <dialog
      #dialog
      aria-labelledby="reject-application-heading"
      class="w-[min(30rem,92vw)] rounded-2xl border border-stone-200 p-0 shadow-raised backdrop:bg-stone-900/40 backdrop:backdrop-blur-[2px]"
      (cancel)="onCancelEvent($event)"
      (close)="onClose()"
      (click)="onBackdropClick($event)"
    >
      <form class="p-6 sm:p-7" novalidate (submit)="onSubmit($event)">
        <h2 id="reject-application-heading" class="text-lg font-bold">
          {{ i18n.t('admin.rejectDialog.title') }}
        </h2>
        @if (subtitle(); as text) {
          <p class="mt-1 text-sm leading-relaxed text-stone-600">{{ text }}</p>
        }

        <div class="mt-5">
          <label
            for="reject-application-reason"
            class="mb-1.5 block text-sm font-medium"
          >
            {{ i18n.t('admin.rejectDialog.reason') }}
          </label>
          <textarea
            [formField]="rejectForm.reason"
            id="reject-application-reason"
            rows="4"
            [placeholder]="i18n.t('admin.rejectDialog.reasonPlaceholder')"
            class="w-full rounded-lg border bg-white px-3.5 py-2 text-sm placeholder-stone-400 shadow-card transition focus:outline-none focus:ring-2"
            [class]="
              reasonInvalid()
                ? 'border-rose-600 focus:ring-rose-600/20'
                : 'border-stone-300 focus:border-brand-600 focus:ring-brand-ring'
            "
            [attr.aria-invalid]="reasonInvalid()"
            [attr.aria-describedby]="reasonDescribedBy()"
          ></textarea>
          <!-- licznik bez aria-live: odczytywanie każdego znaku byłoby hałasem, a opis pola
               i tak trafia do czytnika przez aria-describedby -->
          <p
            id="reject-application-count"
            class="mt-1.5 text-[13px]"
            [class]="reasonInvalid() ? 'font-medium text-rose-600' : 'text-stone-500'"
          >
            {{
              i18n.t('admin.rejectDialog.reasonCounter', {
                used: reasonLength(),
                max: reasonMaxLength,
              })
            }}
          </p>
          @if (reasonInvalid()) {
            <p
              id="reject-application-err"
              class="mt-1.5 text-[13px] font-medium text-rose-600"
            >
              {{ rejectForm.reason().errors()[0]?.message }}
            </p>
          }
        </div>

        @if (serverError(); as msg) {
          <p role="alert" class="alert-danger mt-5">{{ msg }}</p>
        }

        <div class="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            [disabled]="busy()"
            (click)="onCancelClick()"
            class="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 shadow-card transition hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60"
          >
            {{ i18n.t('admin.rejectDialog.cancel') }}
          </button>
          <button
            type="submit"
            [disabled]="busy()"
            class="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-card transition hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-rose-300"
          >
            {{
              busy()
                ? i18n.t('admin.rejectDialog.submitting')
                : i18n.t('admin.rejectDialog.submit')
            }}
          </button>
        </div>
      </form>
    </dialog>
  `,
})
export default class RejectApplicationDialog {
  protected readonly i18n = inject(I18nStore);

  readonly open = input(false);
  /** Puste, gdy modal jest zamknięty — rodzic trzyma zgłoszenie w sygnale, który wraca do null. */
  readonly businessName = input('');
  readonly busy = input(false);
  readonly serverError = input<string | null>(null);

  /** Powód już przycięty — rodzic wysyła go do API bez dalszej obróbki. */
  readonly submitted = output<string>();
  readonly cancelled = output<void>();

  protected readonly reasonMaxLength = REASON_MAX_LENGTH;

  private readonly dialogEl =
    viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly model = signal({ reason: '' });

  protected readonly rejectForm = form(this.model, (p) => {
    // required łapie pole zupełnie puste, pattern samą białą spację: `pattern` przepuszcza
    // wartość pustą (isEmpty), więc bez `required` „Odrzuć" wysłałby pusty powód
    required(p.reason, {
      message: () => translate('admin.rejectDialog.reasonRequired'),
    });
    pattern(p.reason, NON_BLANK, {
      message: () => translate('admin.rejectDialog.reasonRequired'),
    });
    maxLength(p.reason, REASON_MAX_LENGTH, {
      message: () =>
        translate('admin.rejectDialog.reasonTooLong', { max: REASON_MAX_LENGTH }),
    });
    // blokada w trakcie zapytania idzie przez schemat, bo [formField] nie dopuszcza
    // własnego bindowania [disabled] na polu (NG8022)
    disabled(p.reason, () => this.busy());
  });

  protected readonly subtitle = computed(() =>
    this.businessName()
      ? translate('admin.rejectDialog.subtitle', { name: this.businessName() })
      : '',
  );

  protected readonly reasonLength = computed(() => this.model().reason.length);

  protected readonly reasonInvalid = computed(
    () => this.rejectForm.reason().touched() && this.rejectForm.reason().invalid(),
  );
  protected readonly reasonDescribedBy = computed(() =>
    this.reasonInvalid()
      ? 'reject-application-count reject-application-err'
      : 'reject-application-count',
  );

  constructor() {
    // synchronizacja deklaratywnego open() z imperatywnym API <dialog>; showModal() tylko na
    // zamkniętym elemencie — powtórne wywołanie na otwartym rzuca InvalidStateError
    effect(() => {
      const dialog = this.dialogEl().nativeElement;
      if (this.open() && !dialog.open) {
        // czyścimy przy każdym otwarciu: bez tego następne zgłoszenie dostaje w polu powód
        // porzucony przy poprzednim, razem z jego błędami walidacji
        untracked(() => {
          this.model.set({ reason: '' });
          this.rejectForm().reset();
        });
        dialog.showModal();
      } else if (!this.open() && dialog.open) {
        dialog.close();
      }
    });
  }

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy()) return;
    // submit() sam oznacza pole jako touched i pomija akcję przy błędach walidacji —
    // stąd „bez powodu nie da się wysłać" bez własnego sprawdzania w tej metodzie
    await submit(this.rejectForm, async () => {
      this.submitted.emit(this.model().reason.trim());
      return undefined;
    });
  }

  protected onCancelClick(): void {
    this.dialogEl().nativeElement.close();
  }

  /** Escape w trakcie zapytania: gdyby modal się zamknął, rodzic uznałby akcję za anulowaną,
   *  a żądanie i tak by się dokończyło — admin zobaczyłby efekt tego, co „odwołał". */
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
