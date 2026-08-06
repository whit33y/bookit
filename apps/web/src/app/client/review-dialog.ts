import {
  Component,
  ElementRef,
  computed,
  effect,
  input,
  output,
  signal,
  inject,
  untracked,
  viewChild,
} from '@angular/core';
import {
  FormField,
  disabled,
  form,
  max,
  maxLength,
  min,
  submit,
} from '@angular/forms/signals';
import { I18nStore } from '../core/i18n/i18n-store';
import { translate, translatePlural } from '../core/i18n/translate';
import { formatDateTime } from '../shared/business-time';

/** Lustro @MaxLength(500) z CreateReviewDto (apps/api/src/app/reviews/dto/create-review.dto.ts).
 *  Bez tej reguły przekroczenie limitu wraca dopiero z serwera jako jeden ogólny błąd nad
 *  formularzem, a użytkownik nie wie, które pole skrócić. */
const COMMENT_MAX_LENGTH = 500;

/** 0 to stan „nie wybrano" — `required()` na liczbie by go nie złapał, więc pilnuje tego min(1). */
const NO_RATING = 0;

const STARS = [1, 2, 3, 4, 5] as const;



export interface ReviewSubmission {
  rating: number;
  /** null zamiast '' — puste opcjonalne pole pomijamy w body (backend ma forbidNonWhitelisted). */
  comment: string | null;
}

/**
 * Modal wystawiania recenzji na natywnym `<dialog>` (design system §9), zbudowany jak
 * `shared/confirm-dialog.ts`: Escape, trap fokusu i powrót fokusu do przycisku wywołującego
 * dostajemy od przeglądarki, a nie od ręcznie odtwarzanego `role="dialog"`.
 *
 * Komponent jest głupim widokiem — stan sieciowy (`busy`, `serverError`) trzyma rodzic,
 * a stąd wychodzi tylko `submitted` z gotowym ładunkiem.
 */
@Component({
  selector: 'app-review-dialog',
  imports: [FormField],
  template: `
    <!-- klik w tło zamyka modal — wygoda myszy, nie jedyna droga wyjścia (Escape działa natywnie) -->
    <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
    <dialog
      #dialog
      aria-labelledby="review-dialog-heading"
      class="w-[min(30rem,92vw)] rounded-2xl border border-stone-200 p-0 shadow-raised backdrop:bg-stone-900/40 backdrop:backdrop-blur-[2px]"
      (cancel)="onCancelEvent($event)"
      (close)="onClose()"
      (click)="onBackdropClick($event)"
    >
      <form class="p-6 sm:p-7" (submit)="onSubmit($event)">
        <h2 id="review-dialog-heading" class="text-lg font-bold">
          {{ i18n.t('reviewDialog.title') }}
        </h2>
        @if (subtitle(); as text) {
          <p class="mt-1 text-sm text-stone-500">{{ text }}</p>
        }

        <fieldset class="mt-6">
          <legend class="mb-2 text-sm font-medium">
            {{ i18n.t('reviewDialog.rating') }}
          </legend>
          <div class="flex gap-1">
            @for (star of stars; track star) {
              <label class="cursor-pointer">
                <input
                  type="radio"
                  name="review-rating"
                  class="peer sr-only"
                  [checked]="rating() === star"
                  [disabled]="busy()"
                  [attr.aria-describedby]="ratingInvalid() ? 'review-rating-err' : null"
                  (change)="setRating(star)"
                />
                <span
                  aria-hidden="true"
                  class="block rounded-md px-0.5 text-3xl leading-none transition peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-brand-600"
                  [class]="star <= rating() ? 'text-amber-500' : 'text-stone-300'"
                >
                  {{ star <= rating() ? '★' : '☆' }}
                </span>
                <span class="sr-only">{{ ratingLabel(star) }}</span>
              </label>
            }
          </div>
          @if (ratingInvalid()) {
            <p
              id="review-rating-err"
              class="mt-1.5 text-[13px] font-medium text-rose-600"
            >
              {{ reviewForm.rating().errors()[0]?.message }}
            </p>
          }
        </fieldset>

        <div class="mt-5">
          <label for="review-comment" class="mb-1.5 block text-sm font-medium">
            {{ i18n.t('reviewDialog.comment') }}
            <span class="text-stone-400">{{
              i18n.t('reviewDialog.commentOptional')
            }}</span>
          </label>
          <textarea
            [formField]="reviewForm.comment"
            id="review-comment"
            rows="3"
            [placeholder]="i18n.t('reviewDialog.commentPlaceholder')"
            class="w-full rounded-lg border bg-white px-3.5 py-2 text-sm placeholder-stone-400 shadow-card transition focus:outline-none focus:ring-2"
            [class]="
              commentInvalid()
                ? 'border-rose-600 focus:ring-rose-600/20'
                : 'border-stone-300 focus:border-brand-600 focus:ring-brand-ring'
            "
            [attr.aria-invalid]="commentInvalid()"
            [attr.aria-describedby]="commentDescribedBy()"
          ></textarea>
          <!-- licznik bez aria-live: odczytywanie każdego znaku byłoby hałasem, a opis pola
               i tak trafia do czytnika przez aria-describedby -->
          <p
            id="review-comment-count"
            class="mt-1.5 text-[13px]"
            [class]="commentInvalid() ? 'font-medium text-rose-600' : 'text-stone-500'"
          >
            {{
              i18n.t('reviewDialog.commentCounter', {
                used: commentLength(),
                max: commentMaxLength,
              })
            }}
          </p>
          @if (commentInvalid()) {
            <p
              id="review-comment-err"
              class="mt-1.5 text-[13px] font-medium text-rose-600"
            >
              {{ reviewForm.comment().errors()[0]?.message }}
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
            {{ i18n.t('reviewDialog.cancel') }}
          </button>
          <button
            type="submit"
            [disabled]="busy()"
            class="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-card transition hover:bg-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-stone-300"
          >
            {{
              busy()
                ? i18n.t('reviewDialog.submitting')
                : i18n.t('reviewDialog.submit')
            }}
          </button>
        </div>
      </form>
    </dialog>
  `,
})
export default class ReviewDialog {
  protected readonly i18n = inject(I18nStore);

  readonly open = input(false);
  /** Puste, gdy modal jest zamknięty — rodzic trzyma wizytę w sygnale, który wraca do null. */
  readonly serviceName = input('');
  readonly startsAt = input('');
  readonly busy = input(false);
  readonly serverError = input<string | null>(null);

  readonly submitted = output<ReviewSubmission>();
  readonly cancelled = output<void>();

  protected readonly stars = STARS;
  protected readonly commentMaxLength = COMMENT_MAX_LENGTH;

  private readonly dialogEl =
    viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly model = signal({ rating: NO_RATING, comment: '' });

  protected readonly reviewForm = form(this.model, (p) => {
    min(p.rating, 1, { message: () => translate('reviewDialog.ratingRequired') });
    max(p.rating, 5, { message: () => translate('reviewDialog.ratingRequired') });
    maxLength(p.comment, COMMENT_MAX_LENGTH, {
      message: () =>
        translate('reviewDialog.commentTooLong', { max: COMMENT_MAX_LENGTH }),
    });
    // blokada w trakcie wysyłki idzie przez schemat, bo [formField] nie dopuszcza
    // własnego bindowania [disabled] na polu (NG8022)
    disabled(p.comment, () => this.busy());
  });

  // formatDateTime rzuca na pustym stringu, a szablon <dialog> renderuje się także zamknięty
  protected readonly subtitle = computed(() =>
    this.startsAt()
      ? translate('reviewDialog.subtitle', {
          service: this.serviceName(),
          when: formatDateTime(this.startsAt()),
        })
      : '',
  );

  protected readonly rating = computed(() => this.model().rating);
  protected readonly commentLength = computed(() => this.model().comment.length);

  protected readonly ratingInvalid = computed(
    () => this.reviewForm.rating().touched() && this.reviewForm.rating().invalid(),
  );
  protected readonly commentInvalid = computed(
    () =>
      this.reviewForm.comment().touched() && this.reviewForm.comment().invalid(),
  );
  protected readonly commentDescribedBy = computed(() =>
    this.commentInvalid()
      ? 'review-comment-count review-comment-err'
      : 'review-comment-count',
  );

  constructor() {
    // synchronizacja deklaratywnego open() z imperatywnym API <dialog>; showModal() tylko na
    // zamkniętym elemencie — powtórne wywołanie na otwartym rzuca InvalidStateError
    effect(() => {
      const dialog = this.dialogEl().nativeElement;
      if (this.open() && !dialog.open) {
        // czyścimy przy każdym otwarciu: bez tego następna wizyta dostaje w polach ocenę
        // porzuconą przy poprzedniej, razem z jej błędami walidacji
        untracked(() => {
          this.model.set({ rating: NO_RATING, comment: '' });
          this.reviewForm().reset();
        });
        dialog.showModal();
      } else if (!this.open() && dialog.open) {
        dialog.close();
      }
    });
  }

  /** Etykieta dla czytnika ekranu przy gwiazdce — odmiana przez liczbę idzie z `Intl`. */
  protected ratingLabel(star: number): string {
    return translatePlural('rating.starCount', star);
  }

  protected setRating(star: number): void {
    this.model.update((m) => ({ ...m, rating: star }));
    // radio nie ma blura po kliknięciu myszą, a bez touched błąd „wybierz ocenę" zostałby
    // na ekranie po naprawieniu problemu
    this.reviewForm.rating().markAsTouched();
  }

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy()) return;
    // submit() sam oznacza pola jako touched i pomija akcję przy błędach walidacji
    await submit(this.reviewForm, async () => {
      const { rating, comment } = this.model();
      this.submitted.emit({ rating, comment: comment.trim() || null });
      return undefined;
    });
  }

  protected onCancelClick(): void {
    this.dialogEl().nativeElement.close();
  }

  /** Escape w trakcie wysyłki: gdyby modal się zamknął, rodzic uznałby akcję za anulowaną,
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
    // recenzji — wtedy nie ma czego anulować i emisja wprowadziłaby rodzica w błąd
    if (this.open()) {
      this.cancelled.emit();
    }
  }
}
