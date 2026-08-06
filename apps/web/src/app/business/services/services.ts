import { Component, computed, inject, signal } from '@angular/core';
import {
  FormField,
  form,
  hidden,
  max,
  maxLength,
  min,
  required,
  validate,
} from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';
import { collator, numberFormat } from '../../core/i18n/intl';
import { I18nStore } from '../../core/i18n/i18n-store';
import { translate } from '../../core/i18n/translate';
import { ApiClient, apiErrorMessage } from '../../core/api-client';
import AppFormField, {
  submitAuthForm,
} from '../../public/form-field/form-field';
import {
  DepositType,
  depositAmountCents,
  depositError,
} from '../../shared/deposit';
import { PricePlnPipe } from '../../shared/price-pln.pipe';
import EmptyState from '../../shared/ui/empty-state';
import ErrorState from '../../shared/ui/error-state';
import LoadingState from '../../shared/ui/loading-state';

// limity lustrzane do CreateServiceDto (#16)
const NAME_MAX_LENGTH = 100;
const DESCRIPTION_MAX_LENGTH = 2000;
const DURATION_MIN = 1;
const DURATION_MAX = 1440;
const PRICE_MIN = 0;
const PRICE_MAX = 1_000_000;

/** „1 000 000" po polsku, „1,000,000" po angielsku — separator tysięcy wg języka UI. */
const priceFormatter = () => numberFormat({ maximumFractionDigits: 0 });

// lustrzane typy backendu (serviceSelect + employees w findAll, #16/#18/#21)
interface ServiceEmployee {
  id: string;
  name: string;
}
interface Service {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  priceCents: number;
  isActive: boolean;
  // zaliczka (#50/#114) — oba pola null = usługa płatna w całości na miejscu
  depositType: DepositType | null;
  depositValue: number | null;
  employees: ServiceEmployee[];
}
// GET /businesses/mine/employees zwraca więcej pól — bierzemy id + name do multi-selecta
interface Employee {
  id: string;
  name: string;
}
// DELETE zwraca deactivated: true (dezaktywacja, z pełną usługą) lub false (twarde usunięcie)
interface DeleteResult {
  id: string;
  deactivated: boolean;
}

@Component({
  selector: 'app-business-services',
  imports: [
    AppFormField,
    FormField,
    PricePlnPipe,
    LoadingState,
    ErrorState,
    EmptyState,
  ],
  template: `
    <div class="flex flex-1 justify-center px-4 py-8">
      <section
        class="w-full max-w-3xl rounded-xl border border-stone-200 bg-white p-8 shadow-card"
      >
        <div class="flex items-center justify-between gap-4">
          <div>
            <h1 class="text-2xl font-bold">{{ i18n.t('services.title') }}</h1>
            <p class="mt-1 text-sm text-stone-500">
              {{ i18n.t('services.subtitle') }}
            </p>
          </div>
          @if (!formOpen()) {
            <button type="button" class="btn-primary w-auto" (click)="openCreate()">
              {{ i18n.t('services.add') }}
            </button>
          }
        </div>

        @if (serverError(); as msg) {
          <p role="alert" class="alert-danger mt-4">{{ msg }}</p>
        }

        @if (formOpen()) {
          <form
            class="mt-6 rounded-lg border border-stone-200 p-5"
            novalidate
            (submit)="onSubmit($event)"
          >
            <h2 class="text-lg font-semibold">
              {{
                editingId()
                  ? i18n.t('services.formTitle.edit')
                  : i18n.t('services.formTitle.new')
              }}
            </h2>

            <app-form-field
              class="mt-4"
              [field]="serviceForm.name"
              fieldId="name"
              [label]="i18n.t('services.field.name')"
            />

            <div class="mt-4">
              <label for="description" class="mb-1.5 block text-sm font-medium">
                {{ i18n.t('services.field.description') }}
                <span class="text-stone-400">{{
                  i18n.t('services.field.descriptionOptional')
                }}</span>
              </label>
              <textarea
                [formField]="serviceForm.description"
                id="description"
                rows="2"
                class="w-full rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm placeholder-stone-400 shadow-card transition focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-ring"
              ></textarea>
            </div>

            <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label
                  for="durationMin"
                  class="mb-1.5 block text-sm font-medium"
                >
                  {{ i18n.t('services.field.duration') }}
                </label>
                <input
                  [formField]="serviceForm.durationMin"
                  id="durationMin"
                  type="number"
                  inputmode="numeric"
                  [attr.aria-invalid]="durationInvalid()"
                  [attr.aria-describedby]="durationInvalid() ? 'durationMin-err' : null"
                  class="w-full rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm shadow-card transition focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-ring"
                />
                @if (durationInvalid()) {
                  <p
                    id="durationMin-err"
                    class="mt-1.5 text-[13px] font-medium text-rose-600"
                  >
                    {{ serviceForm.durationMin().errors()[0]?.message }}
                  </p>
                }
              </div>

              <div>
                <label for="priceZl" class="mb-1.5 block text-sm font-medium">
                  {{ i18n.t('services.field.price') }}
                </label>
                <input
                  [formField]="serviceForm.priceZl"
                  id="priceZl"
                  type="number"
                  inputmode="decimal"
                  step="0.01"
                  [attr.aria-invalid]="priceInvalid()"
                  [attr.aria-describedby]="priceInvalid() ? 'priceZl-err' : null"
                  class="w-full rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm shadow-card transition focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-ring"
                />
                @if (priceInvalid()) {
                  <p
                    id="priceZl-err"
                    class="mt-1.5 text-[13px] font-medium text-rose-600"
                  >
                    {{ serviceForm.priceZl().errors()[0]?.message }}
                  </p>
                }
              </div>
            </div>

            @if (employees().length) {
              <fieldset class="mt-5">
                <legend class="mb-1.5 block text-sm font-medium">
                  {{ i18n.t('services.field.staff') }}
                </legend>
                <div class="flex flex-col gap-2">
                  @for (emp of employees(); track emp.id) {
                    <label class="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        class="h-4 w-4 rounded border-stone-300 text-brand-700 focus:ring-brand-ring"
                        [checked]="isSelected(emp.id)"
                        (change)="toggleEmployee(emp.id)"
                      />
                      {{ emp.name }}
                    </label>
                  }
                </div>
              </fieldset>
            }

            <fieldset class="mt-5 rounded-lg border border-stone-200 p-4">
              <legend class="px-1 text-sm font-medium">
                {{ i18n.t('services.deposit.legend') }}
              </legend>

              <label class="inline-flex cursor-pointer items-center gap-3">
                <input
                  [formField]="serviceForm.depositEnabled"
                  type="checkbox"
                  role="switch"
                  class="peer sr-only"
                />
                <span
                  aria-hidden="true"
                  class="relative h-6 w-11 rounded-full bg-stone-300 transition after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:bg-brand-700 peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-600 peer-focus-visible:ring-offset-2"
                ></span>
                <span class="text-sm font-medium">
                  {{ i18n.t('services.deposit.enable') }}
                </span>
              </label>

              @if (!serviceForm.depositKind().hidden()) {
                <fieldset class="mt-4">
                  <legend class="mb-1.5 block text-sm font-medium">
                    {{ i18n.t('services.deposit.kindLabel') }}
                  </legend>
                  <div class="flex flex-wrap gap-x-6 gap-y-1">
                    <label class="flex items-center gap-2.5 py-1 text-sm">
                      <input
                        type="radio"
                        name="depositKind"
                        value="FIXED"
                        class="h-4 w-4 border-stone-300 text-brand-700 focus:ring-brand-ring"
                        [checked]="model().depositKind === 'FIXED'"
                        (change)="setDepositKind('FIXED')"
                      />
                      <span>{{ i18n.t('services.deposit.kindFixed') }}</span>
                    </label>
                    <label class="flex items-center gap-2.5 py-1 text-sm">
                      <input
                        type="radio"
                        name="depositKind"
                        value="PERCENT"
                        class="h-4 w-4 border-stone-300 text-brand-700 focus:ring-brand-ring"
                        [checked]="model().depositKind === 'PERCENT'"
                        (change)="setDepositKind('PERCENT')"
                      />
                      <span>{{ i18n.t('services.deposit.kindPercent') }}</span>
                    </label>
                  </div>
                </fieldset>
              }

              @if (!serviceForm.depositAmountZl().hidden()) {
                <div class="mt-4 sm:max-w-[220px]">
                  <label
                    for="depositAmountZl"
                    class="mb-1.5 block text-sm font-medium"
                  >
                    {{ i18n.t('services.deposit.amountLabel') }}
                  </label>
                  <input
                    [formField]="serviceForm.depositAmountZl"
                    id="depositAmountZl"
                    type="number"
                    inputmode="decimal"
                    step="0.01"
                    [attr.aria-invalid]="depositAmountInvalid()"
                    [attr.aria-describedby]="
                      depositAmountInvalid() ? 'depositAmountZl-err' : null
                    "
                    class="w-full rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm shadow-card transition focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-ring"
                  />
                  @if (depositAmountInvalid()) {
                    <p
                      id="depositAmountZl-err"
                      class="mt-1.5 text-[13px] font-medium text-rose-600"
                    >
                      {{ serviceForm.depositAmountZl().errors()[0]?.message }}
                    </p>
                  }
                </div>
              }

              @if (!serviceForm.depositPercent().hidden()) {
                <div class="mt-4 sm:max-w-[220px]">
                  <label
                    for="depositPercent"
                    class="mb-1.5 block text-sm font-medium"
                  >
                    {{ i18n.t('services.deposit.percentLabel') }}
                  </label>
                  <input
                    [formField]="serviceForm.depositPercent"
                    id="depositPercent"
                    type="number"
                    inputmode="numeric"
                    [attr.aria-invalid]="depositPercentInvalid()"
                    [attr.aria-describedby]="
                      depositPercentInvalid()
                        ? 'depositPercent-err'
                        : depositPreviewCents()
                          ? 'depositPercent-hint'
                          : null
                    "
                    class="w-full rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm shadow-card transition focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-ring"
                  />
                  @if (depositPercentInvalid()) {
                    <p
                      id="depositPercent-err"
                      class="mt-1.5 text-[13px] font-medium text-rose-600"
                    >
                      {{ serviceForm.depositPercent().errors()[0]?.message }}
                    </p>
                  } @else if (depositPreviewCents(); as cents) {
                    <p id="depositPercent-hint" class="mt-1.5 text-[13px] text-stone-600">
                      {{
                        i18n.t('services.deposit.preview', {
                          deposit: cents | pricePln,
                          price: priceCents() | pricePln,
                        })
                      }}
                    </p>
                  }
                </div>
              }
            </fieldset>

            <div class="mt-6 flex gap-3">
              <button
                type="submit"
                [disabled]="serviceForm().submitting()"
                class="btn-primary w-auto"
              >
                {{
                  serviceForm().submitting()
                    ? i18n.t('services.saving')
                    : i18n.t('services.save')
                }}
              </button>
              <button
                type="button"
                class="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium shadow-card transition hover:bg-stone-50"
                (click)="closeForm()"
              >
                {{ i18n.t('services.cancel') }}
              </button>
            </div>
          </form>
        }

        <div class="mt-6">
          @if (loading()) {
            <app-loading-state [message]="i18n.t('services.loading')" />
          } @else if (loadError(); as msg) {
            <app-error-state [message]="msg" [retryable]="true" (retry)="load()" />
          } @else if (!services().length) {
            <app-empty-state
              [title]="i18n.t('services.empty')"
              [description]="i18n.t('services.emptyHint')"
            />
          } @else {
            <ul class="flex flex-col gap-3">
              @for (s of services(); track s.id) {
                <li
                  class="flex items-start justify-between gap-4 rounded-lg border border-stone-200 p-4"
                  [class]="s.isActive ? '' : 'opacity-60'"
                >
                  <div>
                    <div class="flex items-center gap-2">
                      <span class="font-medium">{{ s.name }}</span>
                      @if (!s.isActive) {
                        <span
                          class="rounded bg-stone-200 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-stone-600"
                          >{{ i18n.t('services.inactive') }}</span
                        >
                      }
                    </div>
                    <p class="mt-0.5 text-sm text-stone-500">
                      {{
                        i18n.t('services.meta', {
                          minutes: s.durationMin,
                          price: s.priceCents | pricePln,
                        })
                      }}
                    </p>
                    @if (depositCents(s); as cents) {
                      <p class="mt-0.5 text-[13px] text-stone-500">
                        @if (s.depositType === 'PERCENT') {
                          {{
                            i18n.t('services.deposit.rowPercent', {
                              amount: cents | pricePln,
                              percent: s.depositValue ?? 0,
                            })
                          }}
                        } @else {
                          {{
                            i18n.t('services.deposit.rowFixed', {
                              amount: cents | pricePln,
                            })
                          }}
                        }
                      </p>
                    }
                    @if (s.employees.length) {
                      <p class="mt-0.5 text-[13px] text-stone-500">
                        {{
                          i18n.t('services.staffPrefix', {
                            names: employeeNames(s),
                          })
                        }}
                      </p>
                    }
                  </div>
                  <div class="flex shrink-0 gap-2">
                    @if (s.isActive) {
                      <button
                        type="button"
                        class="text-sm font-medium text-brand-600 hover:underline disabled:text-stone-400"
                        [disabled]="rowBusy() === s.id"
                        (click)="openEdit(s)"
                      >
                        {{ i18n.t('services.edit') }}
                      </button>
                      <button
                        type="button"
                        class="text-sm font-medium text-rose-600 hover:underline disabled:text-stone-400"
                        [disabled]="rowBusy() === s.id"
                        (click)="onDelete(s)"
                      >
                        {{ i18n.t('services.delete') }}
                      </button>
                    } @else {
                      <button
                        type="button"
                        class="text-sm font-medium text-brand-600 hover:underline disabled:text-stone-400"
                        [disabled]="rowBusy() === s.id"
                        (click)="onReactivate(s)"
                      >
                        {{ i18n.t('services.activate') }}
                      </button>
                    }
                  </div>
                </li>
              }
            </ul>
          }
        </div>
      </section>
    </div>
  `,
})
export default class BusinessServices {
  private readonly api = inject(ApiClient);
  protected readonly i18n = inject(I18nStore);

  protected readonly loading = signal(true);
  /** Błąd pobrania listy (retry ma sens) — osobno od serverError akcji zapisu/usuwania. */
  protected readonly loadError = signal<string | null>(null);
  protected readonly serverError = signal<string | null>(null);
  protected readonly services = signal<Service[]>([]);
  protected readonly employees = signal<Employee[]>([]);

  protected readonly formOpen = signal(false);
  protected readonly editingId = signal<string | null>(null);
  // pracownicy zaznaczeni w formularzu — osobno od Signal Forms (lista nie wymaga walidacji)
  protected readonly selectedEmployeeIds = signal<string[]>([]);
  // id oryginalnie przypisanych pracowników edytowanej usługi — do wykrycia zmiany (PUT tylko gdy różne)
  private originalEmployeeIds: string[] = [];
  // blokuje podwójne kliknięcie akcji na wierszu (usuń/aktywuj)
  protected readonly rowBusy = signal<string | null>(null);

  protected readonly model = signal({
    name: '',
    description: '',
    durationMin: 30,
    priceZl: 0,
    // zaliczka rozbita na cztery pola formularza, bo backendowa para (typ + jedna liczba
    // znacząca inaczej dla FIXED i PERCENT) nie da się sensownie zwalidować jednym polem;
    // scalenie z powrotem do pary robi onSubmit()
    depositEnabled: false,
    depositKind: 'FIXED' as DepositType,
    /** tryb FIXED — w złotych, jak priceZl; na grosze przeliczamy przy wysyłce */
    depositAmountZl: 0,
    /** tryb PERCENT — całkowity procent ceny */
    depositPercent: 10,
  });

  protected readonly serviceForm = form(this.model, (p) => {
    required(p.name, {
      message: () => translate('validation.serviceName.required'),
    });
    maxLength(p.name, 100, {
      message: () =>
        translate('validation.serviceName.tooLong', { max: NAME_MAX_LENGTH }),
    });
    maxLength(p.description, 2000, {
      message: () =>
        translate('validation.serviceDescription.tooLong', {
          max: DESCRIPTION_MAX_LENGTH,
        }),
    });
    required(p.durationMin, {
      message: () =>
        translate('validation.duration.required', {
          min: DURATION_MIN,
          max: DURATION_MAX,
        }),
    });
    min(p.durationMin, DURATION_MIN, {
      message: () =>
        translate('validation.duration.range', {
          min: DURATION_MIN,
          max: DURATION_MAX,
        }),
    });
    max(p.durationMin, DURATION_MAX, {
      message: () =>
        translate('validation.duration.range', {
          min: DURATION_MIN,
          max: DURATION_MAX,
        }),
    });
    // input number przepuszcza ułamki, a DTO ma @IsInt → 400; walidujemy na froncie
    validate(p.durationMin, ({ value }) => {
      const v = value();
      return v == null || Number.isInteger(v)
        ? undefined
        : {
            kind: 'integer',
            message: translate('validation.duration.integer'),
          };
    });
    required(p.priceZl, {
      message: () =>
        translate('validation.price.required', {
          min: PRICE_MIN,
          max: priceFormatter().format(PRICE_MAX),
        }),
    });
    min(p.priceZl, PRICE_MIN, {
      message: () =>
        translate('validation.price.range', {
          min: PRICE_MIN,
          max: priceFormatter().format(PRICE_MAX),
        }),
    });
    max(p.priceZl, PRICE_MAX, {
      message: () =>
        translate('validation.price.range', {
          min: PRICE_MIN,
          max: priceFormatter().format(PRICE_MAX),
        }),
    });
    // cena w groszach musi być całkowita → max 2 miejsca po przecinku
    validate(p.priceZl, ({ value }) => {
      const v = value();
      if (v == null) return undefined;
      return Math.abs(v * 100 - Math.round(v * 100)) < 1e-6
        ? undefined
        : {
            kind: 'grosze',
            message: translate('validation.price.scale'),
          };
    });

    // Pole ukryte nie wnosi walidacji do formularza — bez tego wyłączona zaliczka
    // (albo drugi, nieaktywny tryb) blokowałaby zapis usługi swoim `required`.
    hidden(p.depositKind, { when: ({ valueOf }) => !valueOf(p.depositEnabled) });
    hidden(p.depositAmountZl, {
      when: ({ valueOf }) =>
        !valueOf(p.depositEnabled) || valueOf(p.depositKind) !== 'FIXED',
    });
    hidden(p.depositPercent, {
      when: ({ valueOf }) =>
        !valueOf(p.depositEnabled) || valueOf(p.depositKind) !== 'PERCENT',
    });

    required(p.depositAmountZl, {
      message: () => translate('validation.deposit.amountRequired'),
    });
    // jak przy cenie: grosze muszą wyjść całkowite
    validate(p.depositAmountZl, ({ value }) => {
      const v = value();
      if (v == null) return undefined;
      return Math.abs(v * 100 - Math.round(v * 100)) < 1e-6
        ? undefined
        : {
            kind: 'grosze',
            message: translate('validation.deposit.amountScale'),
          };
    });
    // reguły krzyżowe (zaliczka ↔ cena) liczy lustro backendu — jeden zestaw komunikatów
    validate(p.depositAmountZl, ({ value, valueOf }) => {
      const v = value();
      if (v == null) return undefined;
      const message = depositError({
        depositType: 'FIXED',
        depositValue: Math.round(v * 100),
        priceCents: Math.round((valueOf(p.priceZl) ?? 0) * 100),
      });
      return message ? { kind: 'deposit', message } : undefined;
    });

    required(p.depositPercent, {
      message: () => translate('validation.deposit.percentRequired'),
    });
    validate(p.depositPercent, ({ value }) => {
      const v = value();
      return v == null || Number.isInteger(v)
        ? undefined
        : {
            kind: 'integer',
            message: translate('validation.deposit.percentInteger'),
          };
    });
    // pokrywa i zakres 1–100, i procent zaokrąglający się do 0 gr przy niskiej cenie
    validate(p.depositPercent, ({ value, valueOf }) => {
      const v = value();
      if (v == null || !Number.isInteger(v)) return undefined;
      const message = depositError({
        depositType: 'PERCENT',
        depositValue: v,
        priceCents: Math.round((valueOf(p.priceZl) ?? 0) * 100),
      });
      return message ? { kind: 'deposit', message } : undefined;
    });
  });

  protected readonly durationInvalid = computed(
    () =>
      this.serviceForm.durationMin().touched() &&
      this.serviceForm.durationMin().invalid(),
  );
  protected readonly priceInvalid = computed(
    () =>
      this.serviceForm.priceZl().touched() && this.serviceForm.priceZl().invalid(),
  );
  protected readonly depositAmountInvalid = computed(
    () =>
      this.serviceForm.depositAmountZl().touched() &&
      this.serviceForm.depositAmountZl().invalid(),
  );
  protected readonly depositPercentInvalid = computed(
    () =>
      this.serviceForm.depositPercent().touched() &&
      this.serviceForm.depositPercent().invalid(),
  );

  /** Cena z formularza w groszach — do podglądu zaliczki przez PricePlnPipe. */
  protected readonly priceCents = computed(() =>
    Math.round((this.model().priceZl ?? 0) * 100),
  );

  /** Podgląd kwoty zaliczki procentowej — ta sama funkcja, która liczy kwotę na liście
   *  i (po stronie backendu) kwotę PaymentIntenta, więc właściciel widzi dokładnie to,
   *  co zapłaci klient. */
  protected readonly depositPreviewCents = computed(() => {
    const m = this.model();
    if (!m.depositEnabled || m.depositKind !== 'PERCENT') return null;
    // Tylko dla procentu przechodzącego walidację. Bez tego warunku podgląd reklamowałby
    // kwotę, której zapis i tak odrzuci (150% ceny → „270 zł przy cenie 180 zł"), i to zanim
    // pole zostanie dotknięte i pokaże błąd. Poprawny procent gwarantuje kwotę >= 1 gr,
    // więc niepusty wynik zawsze ma co pokazać.
    if (this.serviceForm.depositPercent().invalid()) return null;
    return depositAmountCents({
      depositType: 'PERCENT',
      depositValue: m.depositPercent,
      priceCents: this.priceCents(),
    });
  });

  constructor() {
    this.load();
  }

  /** Pobranie listy — osobny sygnał błędu niż akcje (serverError), bo tylko tu retry ma sens
   *  i tylko tu błąd zastępuje całą listę zamiast wisieć nad formularzem. */
  protected load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    Promise.all([
      firstValueFrom(this.api.get<Service[]>('/businesses/mine/services')),
      firstValueFrom(this.api.get<Employee[]>('/businesses/mine/employees')),
    ])
      .then(([services, employees]) => {
        this.services.set(services);
        this.employees.set(employees.map((e) => ({ id: e.id, name: e.name })));
      })
      .catch((err: unknown) => {
        this.loadError.set(
          translate('services.error.load', { detail: apiErrorMessage(err) }),
        );
      })
      .finally(() => this.loading.set(false));
  }

  protected employeeNames(s: Service): string {
    return s.employees.map((e) => e.name).join(', ');
  }

  /** Kwota zaliczki wiersza listy w groszach (procent przeliczony z ceny) albo null. */
  protected depositCents(s: Service): number | null {
    return depositAmountCents({
      depositType: s.depositType,
      depositValue: s.depositValue,
      priceCents: s.priceCents,
    });
  }

  // radio nie ma bindingu w Signal Forms — model jest sygnałem, więc formularz i tak
  // zobaczy zmianę (ten sam wzorzec co toggleEmployee)
  protected setDepositKind(kind: DepositType): void {
    this.model.update((m) => ({ ...m, depositKind: kind }));
  }

  protected isSelected(id: string): boolean {
    return this.selectedEmployeeIds().includes(id);
  }

  protected toggleEmployee(id: string): void {
    this.selectedEmployeeIds.update((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );
  }

  protected openCreate(): void {
    this.model.set({
      name: '',
      description: '',
      durationMin: 30,
      priceZl: 0,
      depositEnabled: false,
      depositKind: 'FIXED',
      depositAmountZl: 0,
      depositPercent: 10,
    });
    this.selectedEmployeeIds.set([]);
    this.originalEmployeeIds = [];
    this.editingId.set(null);
    this.serverError.set(null);
    this.formOpen.set(true);
  }

  protected openEdit(s: Service): void {
    this.model.set({
      name: s.name,
      description: s.description ?? '',
      durationMin: s.durationMin,
      priceZl: s.priceCents / 100,
      depositEnabled: s.depositType !== null,
      // nieaktywny tryb dostaje wartość domyślną, żeby przełączenie radia nie startowało od pustego pola
      depositKind: s.depositType ?? 'FIXED',
      depositAmountZl:
        s.depositType === 'FIXED' ? (s.depositValue ?? 0) / 100 : 0,
      depositPercent:
        s.depositType === 'PERCENT' ? (s.depositValue ?? 10) : 10,
    });
    const ids = s.employees.map((e) => e.id);
    this.selectedEmployeeIds.set(ids);
    this.originalEmployeeIds = ids;
    this.editingId.set(s.id);
    this.serverError.set(null);
    this.formOpen.set(true);
  }

  protected closeForm(): void {
    this.formOpen.set(false);
    this.editingId.set(null);
  }

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    await submitAuthForm(this.serviceForm, this.serverError, async () => {
      const m = this.model();
      // ponytail: puste opcjonalne pole pomijamy → wyczyszczenie opisu przy edycji
      // nie jest wspierane (poza MVP), tak jak telefon w ustawieniach firmy
      // Zaliczkę wysyłamy zawsze w komplecie — także jako para nulli, gdy wyłączona.
      // Backend rewaliduje zaliczkę przy każdej zmianie ceny (services.service.ts), więc
      // pominięcie tych pól przy obniżce ceny kończyłoby się 400 od starej wartości z bazy.
      const deposit = m.depositEnabled
        ? m.depositKind === 'PERCENT'
          ? { depositType: 'PERCENT' as const, depositValue: m.depositPercent }
          : {
              depositType: 'FIXED' as const,
              depositValue: Math.round(m.depositAmountZl * 100),
            }
        : { depositType: null, depositValue: null };
      const payload = {
        name: m.name,
        durationMin: m.durationMin,
        priceCents: Math.round(m.priceZl * 100),
        ...deposit,
        ...(m.description ? { description: m.description } : {}),
      };
      const id = this.editingId();
      if (id) {
        const updated = await firstValueFrom(
          this.api.patch<Service>(`/businesses/mine/services/${id}`, payload),
        );
        // employees przychodzą z osobnego PUT — zachowujemy dotychczasowe z PATCH-a
        let service: Service = { ...updated, employees: this.currentEmployeesFor(id) };
        if (this.employeesChanged()) {
          service = await this.putEmployees(id);
        }
        this.services.update((list) =>
          list.map((s) => (s.id === id ? service : s)),
        );
      } else {
        const created = await firstValueFrom(
          this.api.post<Service>('/businesses/mine/services', payload),
        );
        // usługa już istnieje — od teraz retry to edycja (PATCH), nie kolejny POST;
        // chroni przed duplikatem, gdyby PUT pracowników poniżej zawiódł
        this.services.update((list) =>
          [...list, { ...created, employees: [] }].sort((a, b) =>
            collator().compare(a.name, b.name),
          ),
        );
        this.editingId.set(created.id);
        this.originalEmployeeIds = [];
        if (this.selectedEmployeeIds().length) {
          const withEmployees = await this.putEmployees(created.id);
          this.services.update((list) =>
            list.map((s) => (s.id === created.id ? withEmployees : s)),
          );
        }
      }
      this.closeForm();
    });
  }

  private employeesChanged(): boolean {
    const now = [...this.selectedEmployeeIds()].sort();
    const before = [...this.originalEmployeeIds].sort();
    return now.length !== before.length || now.some((id, i) => id !== before[i]);
  }

  private currentEmployeesFor(id: string): ServiceEmployee[] {
    return this.services().find((s) => s.id === id)?.employees ?? [];
  }

  private putEmployees(id: string): Promise<Service> {
    return firstValueFrom(
      this.api.put<Service>(`/businesses/mine/services/${id}/employees`, {
        employeeIds: this.selectedEmployeeIds(),
      }),
    );
  }

  protected async onDelete(s: Service): Promise<void> {
    // usuwanie nieodwracalne (usługa bez rezerwacji znika na stałe) — potwierdzenie
    const ok = globalThis.confirm(
      translate('services.deleteConfirm', { name: s.name }),
    );
    if (!ok) return;
    this.serverError.set(null);
    this.rowBusy.set(s.id);
    try {
      const res = await firstValueFrom(
        this.api.delete<DeleteResult>(`/businesses/mine/services/${s.id}`),
      );
      if (res.deactivated) {
        // usługa z rezerwacjami: dezaktywowana, zostaje na liście jako nieaktywna
        this.services.update((list) =>
          list.map((x) => (x.id === s.id ? { ...x, isActive: false } : x)),
        );
      } else {
        this.services.update((list) => list.filter((x) => x.id !== s.id));
      }
    } catch (err) {
      this.serverError.set(apiErrorMessage(err));
    } finally {
      this.rowBusy.set(null);
    }
  }

  protected async onReactivate(s: Service): Promise<void> {
    this.serverError.set(null);
    this.rowBusy.set(s.id);
    try {
      const updated = await firstValueFrom(
        this.api.patch<Service>(`/businesses/mine/services/${s.id}`, {
          isActive: true,
        }),
      );
      this.services.update((list) =>
        list.map((x) => (x.id === s.id ? { ...updated, employees: x.employees } : x)),
      );
    } catch (err) {
      this.serverError.set(apiErrorMessage(err));
    } finally {
      this.rowBusy.set(null);
    }
  }
}
