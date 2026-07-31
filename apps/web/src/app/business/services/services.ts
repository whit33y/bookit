import { Component, computed, inject, signal } from '@angular/core';
import {
  FormField,
  form,
  max,
  maxLength,
  min,
  required,
  validate,
} from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';
import { ApiClient, apiErrorMessage } from '../../core/api-client';
import AppFormField, {
  submitAuthForm,
} from '../../public/form-field/form-field';
import { PricePlnPipe } from '../../shared/price-pln.pipe';
import EmptyState from '../../shared/ui/empty-state';
import ErrorState from '../../shared/ui/error-state';
import LoadingState from '../../shared/ui/loading-state';

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
            <h1 class="text-2xl font-bold">Usługi</h1>
            <p class="mt-1 text-sm text-stone-500">
              Zarządzaj ofertą i przypisaniem pracowników
            </p>
          </div>
          @if (!formOpen()) {
            <button type="button" class="btn-primary w-auto" (click)="openCreate()">
              Dodaj usługę
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
              {{ editingId() ? 'Edytuj usługę' : 'Nowa usługa' }}
            </h2>

            <app-form-field
              class="mt-4"
              [field]="serviceForm.name"
              fieldId="name"
              label="Nazwa usługi"
            />

            <div class="mt-4">
              <label for="description" class="mb-1.5 block text-sm font-medium">
                Opis <span class="text-stone-400">(opcjonalnie)</span>
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
                  Czas trwania (min)
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
                  Cena (zł)
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
                  Pracownicy wykonujący usługę
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

            <div class="mt-6 flex gap-3">
              <button
                type="submit"
                [disabled]="serviceForm().submitting()"
                class="btn-primary w-auto"
              >
                {{ serviceForm().submitting() ? 'Zapisywanie…' : 'Zapisz' }}
              </button>
              <button
                type="button"
                class="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium shadow-card transition hover:bg-stone-50"
                (click)="closeForm()"
              >
                Anuluj
              </button>
            </div>
          </form>
        }

        <div class="mt-6">
          @if (loading()) {
            <app-loading-state message="Ładowanie usług…" />
          } @else if (loadError(); as msg) {
            <app-error-state [message]="msg" [retryable]="true" (retry)="load()" />
          } @else if (!services().length) {
            <app-empty-state
              title="Nie masz jeszcze żadnych usług."
              description="Dodaj pierwszą."
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
                          >Nieaktywna</span
                        >
                      }
                    </div>
                    <p class="mt-0.5 text-sm text-stone-500">
                      {{ s.durationMin }} min · {{ s.priceCents | pricePln }}
                    </p>
                    @if (s.employees.length) {
                      <p class="mt-0.5 text-[13px] text-stone-500">
                        Pracownicy:
                        {{ employeeNames(s) }}
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
                        Edytuj
                      </button>
                      <button
                        type="button"
                        class="text-sm font-medium text-rose-600 hover:underline disabled:text-stone-400"
                        [disabled]="rowBusy() === s.id"
                        (click)="onDelete(s)"
                      >
                        Usuń
                      </button>
                    } @else {
                      <button
                        type="button"
                        class="text-sm font-medium text-brand-600 hover:underline disabled:text-stone-400"
                        [disabled]="rowBusy() === s.id"
                        (click)="onReactivate(s)"
                      >
                        Aktywuj
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
  });

  protected readonly serviceForm = form(this.model, (p) => {
    required(p.name, { message: 'Nazwa jest wymagana' });
    maxLength(p.name, 100, {
      message: 'Nazwa może mieć maksymalnie 100 znaków',
    });
    maxLength(p.description, 2000, {
      message: 'Opis może mieć maksymalnie 2000 znaków',
    });
    required(p.durationMin, { message: 'Podaj czas trwania (1–1440 min)' });
    min(p.durationMin, 1, { message: 'Czas trwania to 1–1440 min' });
    max(p.durationMin, 1440, { message: 'Czas trwania to 1–1440 min' });
    // input number przepuszcza ułamki, a DTO ma @IsInt → 400; walidujemy na froncie
    validate(p.durationMin, ({ value }) => {
      const v = value();
      return v == null || Number.isInteger(v)
        ? undefined
        : { kind: 'integer', message: 'Podaj pełną liczbę minut' };
    });
    required(p.priceZl, { message: 'Podaj cenę (0–1 000 000 zł)' });
    min(p.priceZl, 0, { message: 'Cena to 0–1 000 000 zł' });
    max(p.priceZl, 1_000_000, { message: 'Cena to 0–1 000 000 zł' });
    // cena w groszach musi być całkowita → max 2 miejsca po przecinku
    validate(p.priceZl, ({ value }) => {
      const v = value();
      if (v == null) return undefined;
      return Math.abs(v * 100 - Math.round(v * 100)) < 1e-6
        ? undefined
        : { kind: 'grosze', message: 'Cena może mieć maksymalnie 2 miejsca po przecinku' };
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
        this.loadError.set('Nie udało się wczytać usług. ' + apiErrorMessage(err));
      })
      .finally(() => this.loading.set(false));
  }

  protected employeeNames(s: Service): string {
    return s.employees.map((e) => e.name).join(', ');
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
    this.model.set({ name: '', description: '', durationMin: 30, priceZl: 0 });
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
      const payload = {
        name: m.name,
        durationMin: m.durationMin,
        priceCents: Math.round(m.priceZl * 100),
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
            a.name.localeCompare(b.name, 'pl'),
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
      `Usunąć usługę „${s.name}"? Jeśli ma rezerwacje, zostanie dezaktywowana.`,
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
