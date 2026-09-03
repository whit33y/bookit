import {
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
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
import { I18nStore } from '../../core/i18n/i18n-store';
import { translate } from '../../core/i18n/translate';
import { AuthStore } from '../../core/auth/auth-store';
import AppFormField, { submitAuthForm } from '../../public/form-field/form-field';
import AppMap from '../../shared/map/map';
import AppErrorState from '../../shared/ui/error-state';
import AppLoadingState from '../../shared/ui/loading-state';
import { GeocodingService } from '../../shared/geocoding';

interface Category {
  id: string;
  name: string;
  slug: string;
}

/** Lustro `BusinessStatus` z apps/api — stan zgłoszenia firmy (#141). */
type BusinessStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/** Wycinek `GET /businesses/mine/application`, którego potrzebuje ekran. */
interface BusinessApplication {
  status: BusinessStatus;
  rejectionReason: string | null;
}

// Lustrzane do CreateBusinessDto (apps/api) — patterny i długości takie same.
const POSTAL_CODE = /^\d{2}-\d{3}$/;
const NAME_MAX_LENGTH = 100;
const DESCRIPTION_MAX_LENGTH = 2000;
const STREET_MAX_LENGTH = 120;
const CITY_MAX_LENGTH = 80;
const PHONE = /^\+?[0-9\s-]{7,20}$/;

@Component({
  selector: 'app-create-business',
  imports: [AppErrorState, AppFormField, AppLoadingState, AppMap, FormField],
  template: `
    <div class="flex flex-1 items-center justify-center px-4 py-8">
      <section
        class="w-full max-w-2xl rounded-xl border border-stone-200 bg-white p-8 shadow-card"
      >
        <h1 class="text-2xl font-bold">
          {{
            isPending()
              ? i18n.t('createBusiness.pending.title')
              : i18n.t('createBusiness.title')
          }}
        </h1>

        @if (loadingApplication() || isApproved()) {
          <!-- APPROVED nie ma tu czego pokazać: trwa odświeżenie sesji i przejście do panelu -->
          <app-loading-state
            class="mt-2"
            [message]="i18n.t('createBusiness.loading')"
          />
        } @else if (applicationError(); as msg) {
          <app-error-state
            class="mt-4"
            [message]="msg"
            [retryable]="true"
            (retry)="loadApplication()"
          />
        } @else if (isPending()) {
          <p role="status" class="mt-2 text-sm text-stone-500">
            {{ i18n.t('createBusiness.pending.description') }}
          </p>
        } @else {
          <p class="mt-1 text-sm text-stone-500">
            {{ i18n.t('createBusiness.subtitle') }}
          </p>

          @if (isRejected()) {
            <div class="alert-danger mt-4">
              <p class="font-semibold">
                {{ i18n.t('createBusiness.rejected.title') }}
              </p>
              @if (rejectionReason(); as reason) {
                <p class="mt-1">
                  {{ i18n.t('createBusiness.rejected.reason', { reason }) }}
                </p>
              }
              <p class="mt-1">{{ i18n.t('createBusiness.rejected.hint') }}</p>
            </div>
          }

          @if (serverError(); as msg) {
            <p role="alert" class="alert-danger mt-4">{{ msg }}</p>
          }

          <form class="mt-6" novalidate (submit)="onSubmit($event)">
            <app-form-field
              [field]="createForm.name"
              fieldId="name"
              [label]="i18n.t('businessForm.field.name')"
            />

            <div class="mt-4">
              <label for="categoryId" class="mb-1.5 block text-sm font-medium">
                {{ i18n.t('createBusiness.field.category') }}
              </label>
              <select
                [formField]="createForm.categoryId"
                id="categoryId"
                class="w-full rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm shadow-card transition focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-ring"
              >
                <option value="" disabled>
                  {{ i18n.t('createBusiness.categoryPlaceholder') }}
                </option>
                @for (c of categories(); track c.id) {
                  <option [value]="c.id">{{ c.name }}</option>
                }
              </select>
              @if (
                createForm.categoryId().touched() &&
                createForm.categoryId().invalid()
              ) {
                <p class="mt-1.5 text-[13px] font-medium text-rose-600">
                  {{ i18n.t('validation.category.required') }}
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
                  {{ i18n.t('ui.retry') }}
                </button>
              }
            </div>

            <div class="mt-4">
              <label for="description" class="mb-1.5 block text-sm font-medium">
                {{ i18n.t('businessForm.field.description') }}
                <span class="text-stone-400">{{
                  i18n.t('businessForm.field.descriptionOptional')
                }}</span>
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
              [label]="i18n.t('businessForm.field.phone')"
              type="tel"
              autocomplete="tel"
            />

            <div class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <app-form-field
                class="sm:col-span-3"
                [field]="createForm.street"
                fieldId="street"
                [label]="i18n.t('businessForm.field.street')"
              />
              <app-form-field
                [field]="createForm.postalCode"
                fieldId="postalCode"
                [label]="i18n.t('businessForm.field.postalCode')"
              />
              <app-form-field
                class="sm:col-span-2"
                [field]="createForm.city"
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

            <button
              type="submit"
              [disabled]="createForm().submitting()"
              class="btn-primary mt-6"
            >
              {{
                createForm().submitting()
                  ? i18n.t('createBusiness.submitting')
                  : i18n.t('createBusiness.submit')
              }}
            </button>
          </form>
        }
      </section>
    </div>
  `,
})
export default class CreateBusiness {
  private readonly api = inject(ApiClient);
  protected readonly i18n = inject(I18nStore);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly geocoder = inject(GeocodingService);

  protected readonly categories = signal<Category[]>([]);
  // zgłoszenie użytkownika: null = brak zgłoszenia, czyli formularz jak przy pierwszym razie
  protected readonly application = signal<BusinessApplication | null>(null);
  protected readonly loadingApplication = signal(true);
  protected readonly applicationError = signal<string | null>(null);
  protected readonly isPending = computed(
    () => this.application()?.status === 'PENDING',
  );
  protected readonly isApproved = computed(
    () => this.application()?.status === 'APPROVED',
  );
  protected readonly isRejected = computed(
    () => this.application()?.status === 'REJECTED',
  );
  /** Powód bywa pusty (odrzucenie sprzed wymogu uzasadnienia) — sam baner wisi na statusie,
   *  żeby brak powodu nie zamienił odrzucenia w zwykły, niczego niewyjaśniający formularz. */
  protected readonly rejectionReason = computed(
    () => this.application()?.rejectionReason ?? null,
  );
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
    required(p.name, {
      message: () => translate('validation.businessName.required'),
    });
    maxLength(p.name, NAME_MAX_LENGTH, {
      message: () =>
        translate('validation.businessName.tooLong', { max: NAME_MAX_LENGTH }),
    });
    required(p.categoryId, {
      message: () => translate('validation.category.required'),
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
  });

  constructor() {
    this.loadApplication();
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

  /**
   * Stan zgłoszenia rozstrzyga, co w ogóle pokazać (#142) — dlatego pobieramy je przed
   * czymkolwiek innym, zamiast czekać na 409 przy wysłaniu formularza.
   *
   * 404 to nie błąd: tak API mówi „nie masz zgłoszenia", czyli formularz jak dziś. APPROVED
   * nie ma tu czego renderować — użytkownik ma już firmę, więc idzie do panelu.
   */
  protected loadApplication(): void {
    this.loadingApplication.set(true);
    this.applicationError.set(null);
    firstValueFrom(
      this.api.get<BusinessApplication>('/businesses/mine/application'),
    )
      .then(async (app) => {
        this.application.set(app);
        if (app.status !== 'APPROVED') {
          return;
        }
        // Zaakceptowane zgłoszenie to już firma: w bazie rola jest OWNER, ale token w tej
        // sesji wciąż mówi CLIENT, więc bez odświeżenia roleGuard odbiłby /business
        // i użytkownik wróciłby na pusty formularz. Nieudany refresh sam kończy sesję
        // i przekierowuje na /login — ekran zostaje wtedy na stanie ładowania.
        try {
          await this.auth.refresh();
        } catch {
          return;
        }
        await this.router.navigateByUrl('/business');
      })
      .catch((err: unknown) => {
        if (err instanceof HttpErrorResponse && err.status === 404) {
          this.application.set(null);
          return;
        }
        this.applicationError.set(
          translate('createBusiness.error.load', {
            detail: apiErrorMessage(err),
          }),
        );
      })
      .finally(() => this.loadingApplication.set(false));
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
          translate('landing.error.categories', { detail: apiErrorMessage(err) }),
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
      this.geocodeError.set(translate('businessForm.geocode.emptyAddress'));
      return;
    }
    this.geocoding.set(true);
    try {
      const hit = await this.geocoder.geocode(query);
      if (!hit) {
        this.coords.set(null);
        this.geocodeError.set(
          translate('businessForm.geocode.notFound'),
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
          translate('createBusiness.geocode.required'),
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
      const app = await firstValueFrom(
        this.api.post<BusinessApplication>('/businesses', payload),
      );
      // Bez auth.refresh() i bez wejścia do panelu (#142): zgłoszenie nie zmienia roli —
      // OWNER-em użytkownik zostaje dopiero przy akceptacji. Ekran przechodzi w „czeka
      // na akceptację", a odpowiedź niesie stan wprost, więc nie pobieramy go drugi raz.
      this.application.set(app);
    });
  }
}
