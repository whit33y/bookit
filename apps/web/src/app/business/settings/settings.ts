import { Component, computed, inject, signal } from '@angular/core';
import {
  FormField,
  form,
  max,
  maxLength,
  min,
  pattern,
  required,
  validate,
} from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';
import { ApiClient, apiErrorMessage } from '../../core/api-client';
import { I18nStore } from '../../core/i18n/i18n-store';
import { translate } from '../../core/i18n/translate';
import AppFormField, {
  submitAuthForm,
} from '../../public/form-field/form-field';
import AppMap from '../../shared/map/map';
import { GeocodingService } from '../../shared/geocoding';
import ErrorState from '../../shared/ui/error-state';
import LoadingState from '../../shared/ui/loading-state';

// odpowiedź GET /businesses/mine (businessSelect) — tylko pola potrzebne formularzowi
interface Business {
  name: string;
  description: string | null;
  phone: string | null;
  street: string;
  city: string;
  postalCode: string | null;
  lat: number;
  lng: number;
  cancellationHours: number;
}

// Lustrzane do UpdateBusinessDto (apps/api) — patterny i długości takie same.
const POSTAL_CODE = /^\d{2}-\d{3}$/;
const NAME_MAX_LENGTH = 100;
const DESCRIPTION_MAX_LENGTH = 2000;
const STREET_MAX_LENGTH = 120;
const CITY_MAX_LENGTH = 80;
const CANCELLATION_HOURS_MIN = 0;
const CANCELLATION_HOURS_MAX = 720;
const PHONE = /^\+?[0-9\s-]{7,20}$/;

@Component({
  selector: 'app-business-settings',
  imports: [AppFormField, AppMap, FormField, LoadingState, ErrorState],
  template: `
    <div class="flex flex-1 items-center justify-center px-4 py-8">
      <section
        class="w-full max-w-2xl rounded-xl border border-stone-200 bg-white p-8 shadow-card"
      >
        <h1 class="text-2xl font-bold">{{ i18n.t('settings.title') }}</h1>
        <p class="mt-1 text-sm text-stone-500">{{ i18n.t('settings.subtitle') }}</p>

        @if (loading()) {
          <app-loading-state class="mt-6" [message]="i18n.t('settings.loading')" />
        } @else if (loadError(); as msg) {
          <app-error-state
            class="mt-4"
            [message]="msg"
            [retryable]="true"
            (retry)="load()"
          />
        } @else {
          @if (serverError(); as msg) {
            <p role="alert" class="alert-danger mt-4">{{ msg }}</p>
          }
          @if (saved()) {
            <p
              role="status"
              class="mt-4 rounded-lg bg-emerald-50 px-3.5 py-2 text-sm font-medium text-emerald-700"
            >
              {{ i18n.t('settings.saved') }}
            </p>
          }

          <form class="mt-6" novalidate (submit)="onSubmit($event)">
            <app-form-field
              [field]="settingsForm.name"
              fieldId="name"
              [label]="i18n.t('businessForm.field.name')"
            />

            <div class="mt-4">
              <label for="description" class="mb-1.5 block text-sm font-medium">
                {{ i18n.t('businessForm.field.description') }}
                <span class="text-stone-400">{{
                  i18n.t('businessForm.field.descriptionOptional')
                }}</span>
              </label>
              <textarea
                [formField]="settingsForm.description"
                id="description"
                rows="3"
                class="w-full rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm placeholder-stone-400 shadow-card transition focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-ring"
              ></textarea>
            </div>

            <app-form-field
              class="mt-4"
              [field]="settingsForm.phone"
              fieldId="phone"
              [label]="i18n.t('businessForm.field.phone')"
              type="tel"
              autocomplete="tel"
            />

            <div class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <app-form-field
                class="sm:col-span-3"
                [field]="settingsForm.street"
                fieldId="street"
                [label]="i18n.t('businessForm.field.street')"
              />
              <app-form-field
                [field]="settingsForm.postalCode"
                fieldId="postalCode"
                [label]="i18n.t('businessForm.field.postalCode')"
              />
              <app-form-field
                class="sm:col-span-2"
                [field]="settingsForm.city"
                fieldId="city"
                [label]="i18n.t('businessForm.field.city')"
              />
            </div>

            <button
              type="button"
              class="mt-4 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium shadow-card transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:text-stone-400"
              [disabled]="geocoding()"
              (click)="onGeocode()"
            >
              {{
                geocoding()
                  ? i18n.t('businessForm.geocode.searching')
                  : i18n.t('businessForm.geocode.find')
              }}
            </button>

            @if (geocodeError(); as msg) {
              <p role="alert" class="alert-danger mt-3">{{ msg }}</p>
            }

            <div class="mt-4">
              <app-map [lat]="lat()" [lng]="lng()" />
            </div>

            <div class="mt-6">
              <label
                for="cancellationHours"
                class="mb-1.5 block text-sm font-medium"
              >
                {{ i18n.t('settings.cancellationLabel') }}
              </label>
              <input
                [formField]="settingsForm.cancellationHours"
                id="cancellationHours"
                type="number"
                inputmode="numeric"
                class="w-full max-w-xs rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm shadow-card transition focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-ring"
              />
              <p class="mt-1.5 text-[13px] text-stone-500">
                {{
                  i18n.t('settings.cancellationHint', {
                    hours: settingsForm.cancellationHours().value(),
                  })
                }}
              </p>
              @if (
                settingsForm.cancellationHours().touched() &&
                settingsForm.cancellationHours().invalid()
              ) {
                <p class="mt-1.5 text-[13px] font-medium text-rose-600">
                  {{ settingsForm.cancellationHours().errors()[0]?.message }}
                </p>
              }
            </div>

            <button
              type="submit"
              [disabled]="settingsForm().submitting()"
              class="btn-primary mt-6"
            >
              {{
                settingsForm().submitting()
                  ? i18n.t('settings.saving')
                  : i18n.t('settings.submit')
              }}
            </button>
          </form>
        }
      </section>
    </div>
  `,
})
export default class BusinessSettings {
  private readonly api = inject(ApiClient);
  protected readonly i18n = inject(I18nStore);
  private readonly geocoder = inject(GeocodingService);

  protected readonly loading = signal(true);
  /** Błąd pobrania profilu (retry ma sens) — osobno od serverError zapisu; jego brak po
   *  zakończonym ładowaniu znaczy, że formularz ma komplet danych. */
  protected readonly loadError = signal<string | null>(null);
  protected readonly serverError = signal<string | null>(null);
  protected readonly geocodeError = signal<string | null>(null);
  protected readonly geocoding = signal(false);
  protected readonly saved = signal(false);
  // współrzędne aktualne (z prefillu lub geokodowania)
  protected readonly coords = signal<{ lat: number; lng: number } | null>(null);
  protected readonly lat = () => this.coords()?.lat ?? null;
  protected readonly lng = () => this.coords()?.lng ?? null;

  protected readonly model = signal({
    name: '',
    description: '',
    phone: '',
    street: '',
    city: '',
    postalCode: '',
    cancellationHours: 24,
  });

  private readonly addressKey = computed(() => {
    const m = this.model();
    return `${m.street}|${m.postalCode}|${m.city}`;
  });
  // adres, dla którego mamy aktualne współrzędne; rozjazd z addressKey blokuje zapis
  private readonly geocodedKey = signal<string | null>(null);

  protected readonly settingsForm = form(this.model, (p) => {
    required(p.name, {
      message: () => translate('validation.businessName.required'),
    });
    maxLength(p.name, NAME_MAX_LENGTH, {
      message: () =>
        translate('validation.businessName.tooLong', { max: NAME_MAX_LENGTH }),
    });
    maxLength(p.description, DESCRIPTION_MAX_LENGTH, {
      message: () =>
        translate('validation.businessDescription.tooLong', {
          max: DESCRIPTION_MAX_LENGTH,
        }),
    });
    pattern(p.phone, PHONE, {
      message: () => translate('validation.phone.invalid'),
    });
    required(p.street, {
      message: () => translate('validation.businessStreet.required'),
    });
    maxLength(p.street, STREET_MAX_LENGTH, {
      message: () =>
        translate('validation.businessStreet.tooLong', { max: STREET_MAX_LENGTH }),
    });
    required(p.city, {
      message: () => translate('validation.businessCity.required'),
    });
    maxLength(p.city, CITY_MAX_LENGTH, {
      message: () =>
        translate('validation.businessCity.tooLong', { max: CITY_MAX_LENGTH }),
    });
    pattern(p.postalCode, POSTAL_CODE, {
      message: () => translate('validation.postalCode.format'),
    });
    // required łapie puste pole (null z inputu number) — bez tego szłoby null do
    // nienullowalnej kolumny cancellationHours → 500. isEmpty traktuje 0 jako wartość.
    required(p.cancellationHours, {
      message: () =>
        translate('validation.cancellationHours.required', {
          min: CANCELLATION_HOURS_MIN,
          max: CANCELLATION_HOURS_MAX,
        }),
    });
    min(p.cancellationHours, CANCELLATION_HOURS_MIN, {
      message: () =>
        translate('validation.cancellationHours.range', {
          min: CANCELLATION_HOURS_MIN,
          max: CANCELLATION_HOURS_MAX,
        }),
    });
    max(p.cancellationHours, CANCELLATION_HOURS_MAX, {
      message: () =>
        translate('validation.cancellationHours.range', {
          min: CANCELLATION_HOURS_MIN,
          max: CANCELLATION_HOURS_MAX,
        }),
    });
    // input number przepuszcza ułamki (24.5), a DTO ma @IsInt → 400; walidujemy na froncie
    validate(p.cancellationHours, ({ value }) => {
      const v = value();
      return v == null || Number.isInteger(v)
        ? undefined
        : {
            kind: 'integer',
            message: translate('validation.cancellationHours.integer'),
          };
    });
  });

  constructor() {
    this.load();
  }

  /** Pobranie profilu firmy — osobny sygnał błędu niż zapis (serverError), bo tylko tu
   *  retry ma sens i tylko tu błąd zastępuje cały formularz. */
  protected load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    firstValueFrom(this.api.get<Business>('/businesses/mine'))
      .then((b) => {
        this.model.set({
          name: b.name,
          description: b.description ?? '',
          phone: b.phone ?? '',
          street: b.street,
          city: b.city,
          postalCode: b.postalCode ?? '',
          cancellationHours: b.cancellationHours,
        });
        this.coords.set({ lat: b.lat, lng: b.lng });
        // pinezka odpowiada wczytanemu adresowi — bez wymuszania geokodowania przy zapisie
        this.geocodedKey.set(this.addressKey());
      })
      .catch((err: unknown) => {
        this.loadError.set(
          translate('settings.error.load', { detail: apiErrorMessage(err) }),
        );
      })
      .finally(() => this.loading.set(false));
  }

  protected async onGeocode(): Promise<void> {
    this.geocodeError.set(null);
    const m = this.model();
    const query = `${m.street}, ${m.postalCode} ${m.city}`
      .replace(/\s+/g, ' ')
      .trim();
    if (query.replace(/[,\s]/g, '') === '') {
      this.geocodeError.set(translate('businessForm.geocode.emptyAddress'));
      return;
    }
    this.geocoding.set(true);
    try {
      const hit = await this.geocoder.geocode(query);
      if (!hit) {
        this.geocodeError.set(
          translate('businessForm.geocode.notFound'),
        );
        return;
      }
      this.coords.set({ lat: hit.lat, lng: hit.lng });
      this.geocodedKey.set(this.addressKey());
    } finally {
      this.geocoding.set(false);
    }
  }

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    this.geocodeError.set(null);
    this.saved.set(false);
    await submitAuthForm(this.settingsForm, this.serverError, async () => {
      const point = this.coords();
      if (!point || this.addressKey() !== this.geocodedKey()) {
        this.geocodeError.set(
          translate('businessForm.geocode.addressChanged'),
        );
        return;
      }
      const m = this.model();
      // puste opcjonalne pola pomijamy — pusty string nie przechodzi @Matches w DTO.
      // ponytail: wyczyszczenie już ustawionego telefonu/kodu nie jest wspierane (poza MVP)
      const payload = {
        name: m.name,
        street: m.street,
        city: m.city,
        lat: point.lat,
        lng: point.lng,
        cancellationHours: m.cancellationHours,
        description: m.description,
        ...(m.phone ? { phone: m.phone } : {}),
        ...(m.postalCode ? { postalCode: m.postalCode } : {}),
      };
      await firstValueFrom(this.api.patch('/businesses/mine', payload));
      this.saved.set(true);
    });
  }
}
