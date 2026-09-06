import { Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient, apiErrorMessage } from '../core/api-client';
import { AuthStore } from '../core/auth/auth-store';
import { I18nStore } from '../core/i18n/i18n-store';
import { translate } from '../core/i18n/translate';
import ConfirmDialog from '../shared/confirm-dialog';
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_MB,
  imageRejectionMessage,
  oversizeMessage,
  pickedFile,
} from '../shared/image-upload';
import { personMonogram } from '../shared/monogram';

/** Odrzucenie samego pliku ma własny komunikat, reszta idzie ogólną ścieżką błędu. */
function uploadErrorMessage(err: unknown): string {
  return (
    imageRejectionMessage(err) ??
    translate('account.photo.error.upload', { detail: apiErrorMessage(err) })
  );
}

/**
 * Sekcja „Zdjęcie profilowe" w ustawieniach konta (#164): wgranie, podgląd i usunięcie obrazu
 * osoby stojącej za kontem (CONTEXT.md → „Wizerunek").
 *
 * Stoi **poza** formularzem danych osobowych, tak jak „Wygląd" w ustawieniach firmy: obraz nie
 * idzie w `PATCH /users/me`, każdy wybór pliku to osobne żądanie zapisujące się od razu. Jeden
 * przycisk „Zapisz" nad dwoma tak różnymi zapisami kłamałby o tym, co się stanie po kliknięciu.
 *
 * Stan bierze z `AuthStore`, a nie z własnego `GET /users/me`: wersja zdjęcia jest w profilu,
 * który store i tak trzyma dla menu użytkownika, a po wgraniu wystarczy podmienić ją w jednym
 * miejscu, żeby monogram w menu ustąpił zdjęciu bez przeładowania strony. Dopóki profilu nie ma
 * (pobranie jest ciche i może nie wrócić wcale), sekcja nie ma ani czyjego zdjęcia pokazać, ani
 * do czyich inicjałów spaść — mówi to wprost zamiast rysować pusty kwadrat.
 */
@Component({
  selector: 'app-profile-photo',
  imports: [ConfirmDialog],
  template: `
    <section>
      <h2 class="text-lg font-bold">{{ i18n.t('account.photo.title') }}</h2>
      <p class="mt-1 text-sm text-stone-500">{{ i18n.t('account.photo.subtitle') }}</p>

      @if (profile(); as user) {
        <div class="mt-5 flex flex-wrap items-center gap-5">
          <!-- podgląd 1:1, w proporcjach zapisanego obrazu (512×512); NgOptimizedImage nie
               wchodzi w grę — to bajty spod /api, nie statyczny zasób -->
          @if (photoSrc(); as src) {
            <img
              [src]="src"
              [alt]="i18n.t('account.photo.alt')"
              class="h-24 w-24 rounded-2xl object-cover ring-1 ring-inset ring-stone-200"
            />
          } @else {
            <span
              aria-hidden="true"
              class="grid h-24 w-24 place-items-center rounded-2xl bg-brand-50 text-2xl font-extrabold text-brand-700 ring-1 ring-inset ring-brand-200"
              >{{ monogram() }}</span
            >
          }

          <div>
            <p class="text-[13px] text-stone-500">
              {{ i18n.t('account.photo.hint', { max: maxMegabytes }) }}
            </p>
            <div class="mt-2.5 flex flex-wrap items-center gap-2">
              <!-- input w etykiecie: klik w etykietę otwiera wybór pliku, a sam input zostaje
                   ostrym elementem dla klawiatury i czytnika ekranu (stąd focus-within) -->
              <label
                class="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-semibold shadow-card transition focus-within:outline-none focus-within:ring-2 focus-within:ring-brand-600 focus-within:ring-offset-2"
                [class]="
                  busy()
                    ? 'cursor-not-allowed text-stone-400'
                    : 'cursor-pointer hover:bg-stone-50'
                "
              >
                {{
                  uploading()
                    ? i18n.t('account.photo.uploading')
                    : user.avatarVersion
                      ? i18n.t('account.photo.replace')
                      : i18n.t('account.photo.upload')
                }}
                <input
                  type="file"
                  class="sr-only"
                  data-photo-input
                  [accept]="acceptedTypes"
                  [disabled]="busy()"
                  (change)="onPick($event)"
                />
              </label>
              @if (user.avatarVersion) {
                <button
                  type="button"
                  data-photo-remove
                  [disabled]="busy()"
                  (click)="askRemove()"
                  class="rounded-lg px-3 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 disabled:cursor-not-allowed disabled:text-stone-400"
                >
                  {{ i18n.t('account.photo.remove') }}
                </button>
              }
            </div>
            <!-- osobny komunikat o trwającym wgrywaniu: sama zmiana napisu na zablokowanej
                 etykiecie bywa przez czytniki ekranu pominięta, żywy region już nie -->
            @if (uploading()) {
              <p role="status" class="mt-2 text-[13px] font-medium text-stone-500">
                {{ i18n.t('account.photo.uploading') }}
              </p>
            }
            @if (error(); as msg) {
              <p role="alert" class="alert-danger mt-2">{{ msg }}</p>
            }
          </div>
        </div>
      } @else {
        <p class="mt-4 text-sm text-stone-500">
          {{ i18n.t('account.photo.unavailable') }}
        </p>
      }

      <app-confirm-dialog
        [open]="removing()"
        [heading]="i18n.t('account.photo.remove.heading')"
        [message]="i18n.t('account.photo.remove.message')"
        [confirmLabel]="i18n.t('account.photo.remove')"
        [busyLabel]="i18n.t('account.photo.removing')"
        [busy]="busy()"
        (confirmed)="confirmRemoval()"
        (cancelled)="removing.set(false)"
      />
    </section>
  `,
})
export default class ProfilePhoto {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);
  protected readonly i18n = inject(I18nStore);

  protected readonly acceptedTypes = ACCEPTED_IMAGE_TYPES;
  protected readonly maxMegabytes = MAX_IMAGE_MB;

  protected readonly profile = this.auth.profile;
  protected readonly photoSrc = this.auth.profilePhoto;

  /** Trwa żądanie — jedno naraz, bo wgranie i usunięcie dotyczą tego samego slotu. */
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly removing = signal(false);

  /** Usuwanie ma własny stan zajętości w modalu, więc etykieta pod podglądem nie ma prawa
   *  mówić „Wgrywanie…", kiedy w tle leci `DELETE`. */
  protected readonly uploading = computed(() => this.busy() && !this.removing());

  /** Ten sam monogram, co w menu użytkownika (#161) — inicjały imienia i nazwiska, nie osobny
   *  wariant liczony z całej nazwy. */
  protected readonly monogram = computed(() => {
    const profile = this.profile();
    return profile ? personMonogram(profile.firstName, profile.lastName) : '';
  });

  protected onPick(event: Event): void {
    const file = pickedFile(event);
    if (file) {
      void this.upload(file);
    }
  }

  protected askRemove(): void {
    this.error.set(null);
    this.removing.set(true);
  }

  protected async confirmRemoval(): Promise<void> {
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.delete('/users/me/avatar'));
      this.auth.setAvatarVersion(null);
    } catch (err: unknown) {
      this.error.set(
        translate('account.photo.error.remove', { detail: apiErrorMessage(err) }),
      );
    } finally {
      this.busy.set(false);
      this.removing.set(false);
    }
  }

  /** Wgranie zapisuje się od razu; przy odrzuceniu wersja zostaje stara, więc podgląd nadal
   *  pokazuje zdjęcie, które konto faktycznie ma. */
  private async upload(file: File): Promise<void> {
    this.error.set(null);
    const oversize = oversizeMessage(file);
    if (oversize) {
      this.error.set(oversize);
      return;
    }
    const body = new FormData();
    body.append('file', file);
    this.busy.set(true);
    try {
      const res = await firstValueFrom(
        this.api.put<{ version: string }>('/users/me/avatar', body),
      );
      this.auth.setAvatarVersion(res.version);
    } catch (err: unknown) {
      this.error.set(uploadErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
