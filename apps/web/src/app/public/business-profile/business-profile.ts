import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient, apiErrorMessage } from '../../core/api-client';
import AppMap from '../../shared/map/map';
import { PricePlnPipe } from '../../shared/price-pln.pipe';
import EmptyState from '../../shared/ui/empty-state';
import ErrorState from '../../shared/ui/error-state';
import LoadingState from '../../shared/ui/loading-state';
import NotFound from '../not-found/not-found';

interface PublicBusiness {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  phone: string | null;
  street: string;
  city: string;
  postalCode: string | null;
  lat: number;
  lng: number;
  cancellationHours: number;
  category: { id: string; name: string; slug: string };
  services: {
    id: string;
    name: string;
    description: string | null;
    durationMin: number;
    priceCents: number;
    employees: { id: string; name: string }[];
  }[];
  employees: { id: string; name: string }[];
}

/** Inicjały do monogramu — pierwsze litery max dwóch pierwszych słów nazwy. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

@Component({
  selector: 'app-business-profile',
  imports: [
    AppMap,
    PricePlnPipe,
    NotFound,
    RouterLink,
    LoadingState,
    ErrorState,
    EmptyState,
  ],
  template: `
    @if (loading()) {
      <div class="flex flex-1 items-center justify-center px-4 py-16">
        <app-loading-state message="Ładowanie profilu…" />
      </div>
    } @else if (notFound()) {
      <app-not-found />
    } @else if (serverError(); as msg) {
      <div class="mx-auto w-full max-w-4xl px-4 py-8">
        <app-error-state [message]="msg" [retryable]="true" (retry)="retry()" />
      </div>
    } @else if (business(); as b) {
      <div class="mx-auto w-full max-w-4xl px-4 py-8">
        <article class="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-card">
          <div class="h-32 sm:h-36" style="background: var(--gradient-brand)" aria-hidden="true"></div>
          <div class="p-6 sm:p-8">
            <div class="-mt-14 mb-5 flex flex-wrap items-end gap-4 sm:-mt-16">
              <span
                aria-hidden="true"
                class="grid h-20 w-20 place-items-center rounded-2xl border-4 border-white bg-stone-900 text-2xl font-extrabold text-white shadow-lifted sm:h-24 sm:w-24"
              >{{ monogram() }}</span>
              <div class="pb-0.5">
                <h1 class="text-xl font-bold tracking-tight sm:text-2xl">{{ b.name }}</h1>
                <p class="text-sm font-medium text-stone-500">
                  {{ b.category.name }} · {{ b.city }}
                </p>
              </div>
            </div>

            @if (b.description) {
              <p class="mb-6 max-w-2xl text-[15px] leading-relaxed text-stone-600">
                {{ b.description }}
              </p>
            }

            <div class="mb-8 grid gap-4 sm:grid-cols-2">
              <div class="rounded-xl border border-stone-200 bg-stone-50 p-5">
                <h2 class="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-600">
                  Kontakt
                </h2>
                <p class="text-sm font-medium">{{ b.street }}</p>
                <p class="text-sm font-medium">
                  @if (b.postalCode) {{{ b.postalCode }} }{{ b.city }}
                </p>
                @if (b.phone) {
                  <p class="mt-1 text-sm font-medium">
                    <a [href]="telHref(b.phone)" class="text-brand-700 hover:underline">{{ b.phone }}</a>
                  </p>
                }
              </div>
              <app-map class="rounded-xl" [lat]="b.lat" [lng]="b.lng" />
            </div>

            <h2 class="mb-4 text-lg font-bold">Usługi</h2>
            @if (b.services.length) {
              <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                @for (s of b.services; track s.id) {
                  <article class="rounded-xl border border-stone-200 p-5 transition hover:shadow-lifted">
                    <div class="mb-1 flex items-start justify-between gap-2">
                      <h3 class="text-sm font-bold">{{ s.name }}</h3>
                      <span class="whitespace-nowrap rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-semibold text-stone-600">
                        {{ s.durationMin }} min
                      </span>
                    </div>
                    @if (s.description) {
                      <p class="mb-4 text-[13px] leading-relaxed text-stone-500">{{ s.description }}</p>
                    }
                    <div class="mt-4 flex items-center justify-between">
                      <p class="text-sm font-bold">{{ s.priceCents | pricePln }}</p>
                      @if (s.employees.length) {
                        <a
                          routerLink="rezerwacja"
                          [queryParams]="{ serviceId: s.id }"
                          [attr.aria-label]="'Zarezerwuj: ' + s.name"
                          class="inline-block rounded-md bg-brand-700 px-3 py-1.5 text-[13px] font-semibold text-white transition hover:bg-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                        >
                          Zarezerwuj
                        </a>
                      } @else {
                        <!-- bez pracownika nie ma czego rezerwować — wizard skończyłby się
                             ślepą uliczką na kroku 2 -->
                        <button
                          type="button"
                          disabled
                          title="Ta usługa nie ma jeszcze przypisanych pracowników"
                          class="rounded-md bg-brand-700 px-3 py-1.5 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Zarezerwuj
                        </button>
                      }
                    </div>
                  </article>
                }
              </div>
            } @else {
              <app-empty-state title="Ta firma nie ma jeszcze aktywnych usług." />
            }

            @if (b.employees.length) {
              <h2 class="mb-4 mt-8 text-lg font-bold">Zespół</h2>
              <ul class="flex flex-wrap gap-4">
                @for (e of b.employees; track e.id) {
                  <li class="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      class="grid h-10 w-10 place-items-center rounded-full bg-stone-900 text-sm font-bold text-white"
                    >{{ employeeInitials(e.name) }}</span>
                    <span class="text-sm font-medium">{{ e.name }}</span>
                  </li>
                }
              </ul>
            }
          </div>
        </article>
      </div>
    }
  `,
})
export default class BusinessProfile {
  private readonly api = inject(ApiClient);
  private readonly route = inject(ActivatedRoute);
  private slug = '';

  protected readonly business = signal<PublicBusiness | null>(null);
  protected readonly loading = signal(true);
  protected readonly notFound = signal(false);
  protected readonly serverError = signal<string | null>(null);

  protected readonly monogram = computed(() => {
    const b = this.business();
    return b ? initials(b.name) : '';
  });
  protected readonly employeeInitials = initials;

  protected telHref(phone: string): string {
    // tel: URI nie może zawierać spacji (RFC 3966) — wyświetlamy numer ze spacjami,
    // ale w href dajemy wersję bez.
    return 'tel:' + phone.replace(/\s/g, '');
  }

  constructor() {
    // paramMap (nie snapshot) — Angular reużywa instancję komponentu między dwoma
    // trasami :slug, więc bez tego przejście /firma-a → /firma-b pokazywałoby stare dane.
    this.route.paramMap
      .pipe(takeUntilDestroyed())
      .subscribe((pm) => this.load(pm.get('slug') ?? ''));
  }

  /** Ponowienie po błędzie pobrania — slug trzymamy z ostatniego load(). */
  protected retry(): void {
    this.load(this.slug);
  }

  private load(slug: string): void {
    this.slug = slug;
    this.loading.set(true);
    this.notFound.set(false);
    this.serverError.set(null);
    firstValueFrom(this.api.get<PublicBusiness>('/businesses/' + slug))
      .then((b) => this.business.set(b))
      .catch((err) => {
        if (err instanceof HttpErrorResponse && err.status === 404) {
          this.notFound.set(true);
        } else {
          this.serverError.set(apiErrorMessage(err));
        }
      })
      .finally(() => this.loading.set(false));
  }
}
