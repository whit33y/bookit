import {
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  FormField,
  form,
  maxLength,
  pattern,
  required,
} from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';
import { ApiClient, apiErrorMessage } from '../../core/api-client';
import { AuthStore } from '../../core/auth/auth-store';
import AppFormField, { submitAuthForm } from '../../public/form-field/form-field';
import AppMap from '../../shared/map/map';
import { GeocodingService } from '../../shared/geocoding';

interface Category {
  id: string;
  name: string;
  slug: string;
}

// Lustrzane do CreateBusinessDto (apps/api) — patterny i długości takie same.
const POSTAL_CODE = /^\d{2}-\d{3}$/;
const STREET_MAX_LENGTH = 120;
const CITY_MAX_LENGTH = 80;
const PHONE = /^\+?[0-9\s-]{7,20}$/;

@Component({
  selector: 'app-create-business',
  imports: [AppFormField, AppMap, FormField],
  template: `
    <div class="flex flex-1 items-center justify-center px-4 py-8">
      <section
        class="w-full max-w-2xl rounded-xl border border-stone-200 bg-white p-8 shadow-card"
      >
        <h1 class="text-2xl font-bold">Załóż firmę</h1>
        <p class="mt-1 text-sm text-stone-500">
          Utwórz publiczny profil swojej firmy w BookIt
        </p>

        @if (serverError(); as msg) {
          <p role="alert" class="alert-danger mt-4">{{ msg }}</p>
        }

        <form class="mt-6" novalidate (submit)="onSubmit($event)">
          <app-form-field
            [field]="createForm.name"
            fieldId="name"
            label="Nazwa firmy"
          />

          <div class="mt-4">
            <label for="categoryId" class="mb-1.5 block text-sm font-medium">
              Kategoria
            </label>
            <select
              [formField]="createForm.categoryId"
              id="categoryId"
              class="w-full rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm shadow-card transition focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-ring"
            >
              <option value="" disabled>Wybierz kategorię</option>
              @for (c of categories(); track c.id) {
                <option [value]="c.id">{{ c.name }}</option>
              }
            </select>
            @if (
              createForm.categoryId().touched() &&
              createForm.categoryId().invalid()
            ) {
              <p class="mt-1.5 text-[13px] font-medium text-rose-600">
                Wybierz kategorię
              </p>
            }
            @if (categoriesError(); as msg) {
              <p role="alert" class="mt-1.5 text-[13px] font-medium text-rose-600">
                {{ msg }}
              </p>
              <button
                type="button"
                (click)="loadCategories()"
                class="mt-2 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-[13px] font-semibold shadow-card transition hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
              >
                Spróbuj ponownie
              </button>
            }
          </div>

          <div class="mt-4">
            <label for="description" class="mb-1.5 block text-sm font-medium">
              Opis <span class="text-stone-400">(opcjonalnie)</span>
            </label>
            <textarea
              [formField]="createForm.description"
              id="description"
              rows="3"
              class="w-full rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm placeholder-stone-400 shadow-card transition focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-ring"
            ></textarea>
          </div>

          <app-form-field
            class="mt-4"
            [field]="createForm.phone"
            fieldId="phone"
            label="Telefon (opcjonalnie)"
            type="tel"
            autocomplete="tel"
          />

          <div class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <app-form-field
              class="sm:col-span-3"
              [field]="createForm.street"
              fieldId="street"
              label="Ulica i numer"
            />
            <app-form-field
              [field]="createForm.postalCode"
              fieldId="postalCode"
              label="Kod pocztowy (opcjonalnie)"
            />
            <app-form-field
              class="sm:col-span-2"
              [field]="createForm.city"
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

          <button
            type="submit"
            [disabled]="createForm().submitting()"
            class="btn-primary mt-6"
          >
            {{ createForm().submitting() ? 'Zakładanie…' : 'Załóż firmę' }}
          </button>
        </form>
      </section>
    </div>
  `,
})
export default class CreateBusiness {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly geocoder = inject(GeocodingService);

  protected readonly categories = signal<Category[]>([]);
  protected readonly serverError = signal<string | null>(null);
  protected readonly categoriesError = signal<string | null>(null);
  protected readonly geocodeError = signal<string | null>(null);
  protected readonly geocoding = signal(false);
  // współrzędne z geokodowania — bez nich formularz się nie wysyła
  protected readonly coords = signal<{ lat: number; lng: number } | null>(null);
  protected readonly lat = () => this.coords()?.lat ?? null;
  protected readonly lng = () => this.coords()?.lng ?? null;

  protected readonly model = signal({
    name: '',
    categoryId: '',
    description: '',
    phone: '',
    street: '',
    city: '',
    postalCode: '',
  });

  // klucz zmienia się tylko przy edycji pól adresu (nie nazwy/telefonu) — computed
  // memoizuje po wartości, więc efekt czyszczący pinezkę nie odpala się na każdy klawisz
  private readonly addressKey = computed(() => {
    const m = this.model();
    return `${m.street}|${m.postalCode}|${m.city}`;
  });

  protected readonly createForm = form(this.model, (p) => {
    required(p.name, { message: 'Nazwa jest wymagana' });
    maxLength(p.name, 100, {
      message: 'Nazwa może mieć maksymalnie 100 znaków',
    });
    required(p.categoryId, { message: 'Wybierz kategorię' });
    maxLength(p.description, 2000, {
      message: 'Opis może mieć maksymalnie 2000 znaków',
    });
    pattern(p.phone, PHONE, { message: 'Nieprawidłowy numer telefonu' });
    required(p.street, { message: 'Ulica jest wymagana' });
    maxLength(p.street, STREET_MAX_LENGTH, {
      message: `Ulica może mieć maksymalnie ${STREET_MAX_LENGTH} znaków`,
    });
    required(p.city, { message: 'Miasto jest wymagane' });
    maxLength(p.city, CITY_MAX_LENGTH, {
      message: `Miasto może mieć maksymalnie ${CITY_MAX_LENGTH} znaków`,
    });
    pattern(p.postalCode, POSTAL_CODE, {
      message: 'Kod pocztowy w formacie 00-000',
    });
  });

  constructor() {
    this.loadCategories();

    // zmiana adresu unieważnia zgeokodowaną pinezkę — inaczej wysłalibyśmy stare
    // współrzędne dla nowego adresu; użytkownik musi kliknąć „Znajdź na mapie" ponownie
    effect(() => {
      this.addressKey();
      untracked(() => {
        if (this.coords() !== null) {
          this.coords.set(null);
          this.geocodeError.set(null);
        }
      });
    });
  }

  /** Kategoria jest wymagana, a pusty select blokuje wysłanie formularza — bez ponowienia
   *  jedynym wyjściem z nieudanego pobrania byłoby przeładowanie strony. */
  protected loadCategories(): void {
    this.categoriesError.set(null);
    firstValueFrom(this.api.get<Category[]>('/categories'))
      .then((cats) => this.categories.set(cats))
      .catch((err: unknown) => {
        this.categories.set([]);
        this.categoriesError.set(
          'Nie udało się wczytać listy kategorii. ' + apiErrorMessage(err),
        );
      });
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
        this.coords.set(null);
        this.geocodeError.set(
          'Nie znaleziono adresu na mapie. Sprawdź dane i spróbuj ponownie.',
        );
        return;
      }
      this.coords.set({ lat: hit.lat, lng: hit.lng });
    } finally {
      this.geocoding.set(false);
    }
  }

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    this.geocodeError.set(null);
    await submitAuthForm(this.createForm, this.serverError, async () => {
      const point = this.coords();
      if (!point) {
        this.geocodeError.set(
          'Najpierw znajdź adres na mapie — bez współrzędnych nie można założyć firmy.',
        );
        return;
      }
      const m = this.model();
      // pomijamy puste opcjonalne pola — pusty string nie przechodzi @Matches w DTO
      const payload = {
        name: m.name,
        categoryId: m.categoryId,
        street: m.street,
        city: m.city,
        lat: point.lat,
        lng: point.lng,
        ...(m.description ? { description: m.description } : {}),
        ...(m.phone ? { phone: m.phone } : {}),
        ...(m.postalCode ? { postalCode: m.postalCode } : {}),
      };
      await firstValueFrom(this.api.post('/businesses', payload));
      // rola w DB jest już OWNER — refresh wydaje token z nową rolą, bez ponownego logowania
      try {
        await this.auth.refresh();
      } catch {
        // firma powstała, ale sesji nie dało się odświeżyć — AuthStore.refresh()
        // już wylogował i przekierował na /login; nie pokazujemy generycznego błędu
        return;
      }
      await this.router.navigateByUrl('/business');
    });
  }
}
