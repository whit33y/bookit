import { Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient, apiErrorMessage } from '../../core/api-client';
import { I18nStore } from '../../core/i18n/i18n-store';
import type { TranslationKey } from '../../core/i18n/pl';
import { translate } from '../../core/i18n/translate';
import {
  businessImageUrl,
  type BusinessImageKind,
} from '../../shared/business-image';
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_MB,
  imageRejectionMessage,
  oversizeMessage,
  pickedFile,
} from '../../shared/image-upload';
import { monogramInitials } from '../../shared/monogram';
import ConfirmDialog from '../../shared/confirm-dialog';

interface Slot {
  kind: BusinessImageKind;
  label: TranslationKey;
  hint: TranslationKey;
  removeMessage: TranslationKey;
}

const SLOTS: readonly Slot[] = [
  {
    kind: 'logo',
    label: 'appearance.logo',
    hint: 'appearance.logoHint',
    removeMessage: 'appearance.remove.logoMessage',
  },
  {
    kind: 'cover',
    label: 'appearance.cover',
    hint: 'appearance.coverHint',
    removeMessage: 'appearance.remove.coverMessage',
  },
];

/** Odrzucenie samego pliku ma własny komunikat, reszta idzie ogólną ścieżką błędu. */
function uploadErrorMessage(err: unknown): string {
  return (
    imageRejectionMessage(err) ??
    translate('appearance.error.upload', { detail: apiErrorMessage(err) })
  );
}

/**
 * Sekcja „Wygląd" w ustawieniach firmy (#154): logo firmy i okładka profilu.
 *
 * Stoi **poza** formularzem ustawień, bo obrazy nie idą w `PATCH /businesses/mine` — każdy
 * wybór pliku to osobne żądanie, które zapisuje się od razu. Dzięki temu `UpdateBusinessDto`
 * zostaje czystym JSON-em, a właściciel nie musi klikać „Zapisz zmiany", żeby zobaczyć efekt.
 *
 * Podgląd odtwarza układ profilu publicznego (pas okładki z nałożonym kwadratem logo, te same
 * proporcje). Bez kadrowania w tej zmianie jest jedynym miejscem, gdzie właściciel zobaczy,
 * co utnie `object-cover`.
 */
@Component({
  selector: 'app-business-appearance',
  imports: [ConfirmDialog],
  template: `
    <section>
      <h2 class="text-lg font-bold">{{ i18n.t('appearance.title') }}</h2>
      <p class="mt-1 text-sm text-stone-500">{{ i18n.t('appearance.subtitle') }}</p>

      <!-- podgląd jak na profilu publicznym; NgOptimizedImage nie wchodzi w grę — to nie są
           statyczne zasoby, tylko bajty spod /api o nieznanych z góry wymiarach -->
      <div class="mt-4 overflow-hidden rounded-xl border border-stone-200">
        @if (coverSrc(); as src) {
          <img
            [src]="src"
            [alt]="i18n.t('appearance.alt.cover', { name: businessName() })"
            class="h-32 w-full object-cover sm:h-36"
          />
        } @else {
          <div class="h-32 bg-brand-gradient sm:h-36" aria-hidden="true"></div>
        }
        <div class="px-5 pb-4">
          <div class="-mt-14 flex items-end gap-4 sm:-mt-16">
            @if (logoSrc(); as src) {
              <img
                [src]="src"
                [alt]="i18n.t('appearance.alt.logo', { name: businessName() })"
                class="h-20 w-20 rounded-2xl border-4 border-white object-cover shadow-lifted sm:h-24 sm:w-24"
              />
            } @else {
              <span
                aria-hidden="true"
                class="grid h-20 w-20 place-items-center rounded-2xl border-4 border-white bg-stone-900 text-2xl font-extrabold text-white shadow-lifted sm:h-24 sm:w-24"
                >{{ monogram() }}</span
              >
            }
            <p class="pb-1 text-sm font-bold">{{ businessName() }}</p>
          </div>
        </div>
      </div>

      <div class="mt-5 grid gap-5 sm:grid-cols-2">
        @for (slot of slots; track slot.kind) {
          <div>
            <h3 class="text-sm font-semibold">{{ i18n.t(slot.label) }}</h3>
            <p class="mt-1 text-[13px] text-stone-500">
              {{ i18n.t(slot.hint, { max: maxMegabytes }) }}
            </p>
            <div class="mt-2.5 flex flex-wrap items-center gap-2">
              <!-- input w etykiecie: klik w etykietę otwiera wybór pliku, a sam input zostaje
                   ostrym elementem dla klawiatury i czytnika ekranu (stąd focus-within) -->
              <label
                class="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-semibold shadow-card transition focus-within:outline-none focus-within:ring-2 focus-within:ring-brand-600 focus-within:ring-offset-2"
                [class]="
                  busy() !== null
                    ? 'cursor-not-allowed text-stone-400'
                    : 'cursor-pointer hover:bg-stone-50'
                "
              >
                {{
                  uploading() === slot.kind
                    ? i18n.t('appearance.uploading')
                    : versions()[slot.kind]
                      ? i18n.t('appearance.replace')
                      : i18n.t('appearance.upload')
                }}
                <input
                  type="file"
                  class="sr-only"
                  [attr.data-kind]="slot.kind"
                  [accept]="acceptedTypes"
                  [disabled]="busy() !== null"
                  (change)="onPick($event, slot.kind)"
                />
              </label>
              @if (versions()[slot.kind]) {
                <button
                  type="button"
                  [attr.data-remove]="slot.kind"
                  [disabled]="busy() !== null"
                  (click)="askRemove(slot.kind)"
                  class="rounded-lg px-3 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 disabled:cursor-not-allowed disabled:text-stone-400"
                >
                  {{ i18n.t('appearance.remove') }}
                </button>
              }
            </div>
            <!-- osobny komunikat o trwającym wgrywaniu: sama zmiana napisu na zablokowanej
                 etykiecie bywa przez czytniki ekranu pominięta, żywy region już nie -->
            @if (uploading() === slot.kind) {
              <p role="status" class="mt-2 text-[13px] font-medium text-stone-500">
                {{ i18n.t('appearance.uploading') }}
              </p>
            }
            @if (errors()[slot.kind]; as msg) {
              <p role="alert" class="alert-danger mt-2">{{ msg }}</p>
            }
          </div>
        }
      </div>

      <app-confirm-dialog
        [open]="pendingRemoval() !== null"
        [heading]="i18n.t('appearance.remove.heading')"
        [message]="removalMessage()"
        [confirmLabel]="i18n.t('appearance.remove.confirm')"
        [busyLabel]="i18n.t('appearance.removing')"
        [busy]="busy() !== null"
        (confirmed)="confirmRemoval()"
        (cancelled)="pendingRemoval.set(null)"
      />
    </section>
  `,
})
export default class BusinessAppearance {
  private readonly api = inject(ApiClient);
  protected readonly i18n = inject(I18nStore);

  readonly businessId = input.required<string>();
  readonly businessName = input.required<string>();
  readonly logoVersion = input<string | null>(null);
  readonly coverVersion = input<string | null>(null);

  protected readonly slots = SLOTS;
  protected readonly acceptedTypes = ACCEPTED_IMAGE_TYPES;
  protected readonly maxMegabytes = MAX_IMAGE_MB;

  /** Wersje obrazów: po wgraniu lub usunięciu zmienia je ta sekcja, a `linkedSignal` przywraca
   *  stan z serwera, kiedy rodzic przeładuje profil firmy. */
  protected readonly versions = linkedSignal<Record<BusinessImageKind, string | null>>(
    () => ({ logo: this.logoVersion(), cover: this.coverVersion() }),
  );

  /** Slot, na którym trwa żądanie. Blokuje oba naraz — równoległe wgrania zapisują ten sam
   *  profil, a właściciel i tak ocenia efekt po podglądzie, nie po dwóch spinnerach. */
  protected readonly busy = signal<BusinessImageKind | null>(null);
  protected readonly errors = signal<Partial<Record<BusinessImageKind, string>>>({});
  protected readonly pendingRemoval = signal<BusinessImageKind | null>(null);

  /** Slot, na którym trwa wgrywanie — usuwanie idzie tym samym `busy`, ale ma własny stan
   *  ładowania w modalu, więc etykieta pod podglądem nie ma prawa mówić „Wgrywanie…". */
  protected readonly uploading = computed(() =>
    this.pendingRemoval() === null ? this.busy() : null,
  );

  protected readonly monogram = computed(() => monogramInitials(this.businessName()));

  protected readonly logoSrc = computed(() =>
    businessImageUrl(this.businessId(), 'logo', this.versions().logo),
  );
  protected readonly coverSrc = computed(() =>
    businessImageUrl(this.businessId(), 'cover', this.versions().cover),
  );

  protected readonly removalMessage = computed(() => {
    const kind = this.pendingRemoval();
    const slot = SLOTS.find((s) => s.kind === kind);
    return slot ? translate(slot.removeMessage) : '';
  });

  protected onPick(event: Event, kind: BusinessImageKind): void {
    const file = pickedFile(event);
    if (file) {
      void this.upload(kind, file);
    }
  }

  protected askRemove(kind: BusinessImageKind): void {
    this.setError(kind, undefined);
    this.pendingRemoval.set(kind);
  }

  protected async confirmRemoval(): Promise<void> {
    const kind = this.pendingRemoval();
    if (kind === null) {
      return;
    }
    this.busy.set(kind);
    try {
      await firstValueFrom(this.api.delete(`/businesses/mine/images/${kind}`));
      this.versions.update((v) => ({ ...v, [kind]: null }));
    } catch (err: unknown) {
      this.setError(
        kind,
        translate('appearance.error.remove', { detail: apiErrorMessage(err) }),
      );
    } finally {
      this.busy.set(null);
      this.pendingRemoval.set(null);
    }
  }

  /** Wgranie zapisuje się od razu; przy odrzuceniu wersja zostaje stara, więc podgląd nadal
   *  pokazuje obraz, który firma faktycznie ma. */
  private async upload(kind: BusinessImageKind, file: File): Promise<void> {
    this.setError(kind, undefined);
    const oversize = oversizeMessage(file);
    if (oversize) {
      this.setError(kind, oversize);
      return;
    }
    const body = new FormData();
    body.append('file', file);
    this.busy.set(kind);
    try {
      const res = await firstValueFrom(
        this.api.put<{ kind: string; version: string }>(
          `/businesses/mine/images/${kind}`,
          body,
        ),
      );
      this.versions.update((v) => ({ ...v, [kind]: res.version }));
    } catch (err: unknown) {
      this.setError(kind, uploadErrorMessage(err));
    } finally {
      this.busy.set(null);
    }
  }

  private setError(kind: BusinessImageKind, message: string | undefined): void {
    this.errors.update((current) => ({ ...current, [kind]: message }));
  }
}
