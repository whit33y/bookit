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
const PHONE = /^\+?[0-9\s-]{7,20}$/;

@Component({
  selector: 'app-business-settings',
  imports: [AppFormField, AppMap, FormField, LoadingState, ErrorState],
  template: `
    <div class="flex flex-1 items-center justify-center px-4 py-8">
      <section
        class="w-full max-w-2xl rounded-xl border border-stone-200 bg-white p-8 shadow-card"
      >
        <h1 class="text-2xl font-bold">Ustawienia firmy</h1>
        <p class="mt-1 text-sm text-stone-500">
          Edytuj profil swojej firmy i politykę odwołań
        </p>

        @if (loading()) {
          <app-loading-state class="mt-6" message="Ładowanie danych firmy…" />
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
              Zapisano zmiany
            </p>
          }

          <form class="mt-6" novalidate (submit)="onSubmit($event)">
            <app-form-field
              [field]="settingsForm.name"
              fieldId="name"
              label="Nazwa firmy"
            />

            <div class="mt-4">
              <label for="description" class="mb-1.5 block text-sm font-medium">
                Opis <span class="text-stone-400">(opcjonalnie)</span>
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
              label="Telefon (opcjonalnie)"
              type="tel"
              autocomplete="tel"
            />

            <div class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <app-form-field
                class="sm:col-span-3"
                [field]="settingsForm.street"
                fieldId="street"
                label="Ulica i numer"
              />
              <app-form-field
                [field]="settingsForm.postalCode"
                fieldId="postalCode"
                label="Kod pocztowy (opcjonalnie)"
              />
              <app-form-field
                class="sm:col-span-2"
                [field]="settingsForm.city"
                fieldId="city"
                label="Miasto"
              />
            </div>

            <button
              type="button"
              class="mt-4 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium shadow-card transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:text-stone-400"
              [disabled]="geocoding()"
              (click)="onGeocode()"
            >
              {{ geocoding() ? 'Szukam…' : 'Znajdź na mapie' }}
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
                Polityka odwołań (godziny)
              </label>
              <input
                [formField]="settingsForm.cancellationHours"
                id="cancellationHours"
                type="number"
                inputmode="numeric"
                class="w-full max-w-xs rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm shadow-card transition focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-ring"
              />
              <p class="mt-1.5 text-[13px] text-stone-500">
                Klient może odwołać rezerwację do
                {{ settingsForm.cancellationHours().value() }} godzin przed
                wizytą.
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
                settingsForm().submitting() ? 'Zapisywanie…' : 'Zapisz zmiany'
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
    required(p.name, { message: 'Nazwa jest wymagana' });
    maxLength(p.name, 100, {
      message: 'Nazwa może mieć maksymalnie 100 znaków',
    });
    maxLength(p.description, 2000, {
      message: 'Opis może mieć maksymalnie 2000 znaków',
    });
    pattern(p.phone, PHONE, { message: 'Nieprawidłowy numer telefonu' });
    required(p.street, { message: 'Ulica jest wymagana' });
    required(p.city, { message: 'Miasto jest wymagane' });
    pattern(p.postalCode, POSTAL_CODE, {
      message: 'Kod pocztowy w formacie 00-000',
    });
    // required łapie puste pole (null z inputu number) — bez tego szłoby null do
    // nienullowalnej kolumny cancellationHours → 500. isEmpty traktuje 0 jako wartość.
    required(p.cancellationHours, { message: 'Podaj liczbę godzin (0–720)' });
    min(p.cancellationHours, 0, { message: 'Podaj wartość od 0 do 720' });
    max(p.cancellationHours, 720, { message: 'Podaj wartość od 0 do 720' });
    // input number przepuszcza ułamki (24.5), a DTO ma @IsInt → 400; walidujemy na froncie
    validate(p.cancellationHours, ({ value }) => {
      const v = value();
      return v == null || Number.isInteger(v)
        ? undefined
        : { kind: 'integer', message: 'Podaj pełną liczbę godzin' };
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
        this.loadError.set('Nie udało się wczytać danych firmy. ' + apiErrorMessage(err));
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
      this.geocodeError.set('Podaj adres, aby wyszukać na mapie.');
      return;
    }
    this.geocoding.set(true);
    try {
      const hit = await this.geocoder.geocode(query);
      if (!hit) {
        this.geocodeError.set(
          'Nie znaleziono adresu na mapie. Sprawdź dane i spróbuj ponownie.',
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
          'Zmieniono adres — kliknij „Znajdź na mapie”, aby zaktualizować pinezkę przed zapisem.',
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
