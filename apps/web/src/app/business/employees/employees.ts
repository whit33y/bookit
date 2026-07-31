import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  email,
  form,
  maxLength,
  pattern,
  required,
} from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';
import { ApiClient, apiErrorMessage } from '../../core/api-client';
import AppFormField, {
  EMAIL_WITH_TLD,
  submitAuthForm,
} from '../../public/form-field/form-field';
import EmptyState from '../../shared/ui/empty-state';
import ErrorState from '../../shared/ui/error-state';
import LoadingState from '../../shared/ui/loading-state';

// lustrzane typy backendu (employeeSelect w findAll, #17)
interface LinkedUser {
  email: string;
  firstName: string | null;
  lastName: string | null;
}
interface Employee {
  id: string;
  name: string;
  isActive: boolean;
  user: LinkedUser | null;
}
// DELETE zwraca deactivated: true (dezaktywacja, z pełnym pracownikiem) lub false (twarde usunięcie)
interface DeleteResult {
  id: string;
  deactivated: boolean;
}

@Component({
  selector: 'app-business-employees',
  imports: [AppFormField, RouterLink, LoadingState, ErrorState, EmptyState],
  template: `
    <div class="flex flex-1 justify-center px-4 py-8">
      <section
        class="w-full max-w-3xl rounded-xl border border-stone-200 bg-white p-8 shadow-card"
      >
        <div class="flex items-center justify-between gap-4">
          <div>
            <h1 class="text-2xl font-bold">Pracownicy</h1>
            <p class="mt-1 text-sm text-stone-500">Zarządzaj zespołem</p>
          </div>
          @if (!formOpen()) {
            <button type="button" class="btn-primary w-auto" (click)="openCreate()">
              Dodaj pracownika
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
              {{ editingId() ? 'Edytuj pracownika' : 'Nowy pracownik' }}
            </h2>

            <app-form-field
              class="mt-4"
              [field]="employeeForm.name"
              fieldId="name"
              label="Imię i nazwisko"
            />

            <div class="mt-4">
              <app-form-field
                [field]="employeeForm.email"
                fieldId="email"
                type="email"
                label="E-mail konta (opcjonalnie)"
                autocomplete="off"
              />
              <p class="mt-1.5 text-[13px] text-stone-500">
                Powiąże istniejące konto użytkownika i nada mu rolę pracownika.
              </p>
            </div>

            <div class="mt-6 flex gap-3">
              <button
                type="submit"
                [disabled]="employeeForm().submitting()"
                class="btn-primary w-auto"
              >
                {{ employeeForm().submitting() ? 'Zapisywanie…' : 'Zapisz' }}
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
            <app-loading-state message="Ładowanie pracowników…" />
          } @else if (loadError(); as msg) {
            <app-error-state [message]="msg" [retryable]="true" (retry)="load()" />
          } @else if (!employees().length) {
            <app-empty-state
              title="Nie masz jeszcze żadnych pracowników."
              description="Dodaj pierwszego."
            />
          } @else {
            <ul class="flex flex-col gap-3">
              @for (e of employees(); track e.id) {
                <li
                  class="flex items-start justify-between gap-4 rounded-lg border border-stone-200 p-4"
                  [class]="e.isActive ? '' : 'opacity-60'"
                >
                  <div>
                    <div class="flex items-center gap-2">
                      <span class="font-medium">{{ e.name }}</span>
                      @if (!e.isActive) {
                        <span
                          class="rounded bg-stone-200 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-stone-600"
                          >Nieaktywny</span
                        >
                      }
                    </div>
                    @if (e.user) {
                      <p class="mt-0.5 text-[13px] text-stone-500">
                        Konto: {{ e.user.email }}
                      </p>
                    }
                  </div>
                  <div class="flex shrink-0 gap-2">
                    @if (e.isActive) {
                      <a
                        [routerLink]="['/business/employees', e.id, 'schedule']"
                        class="text-sm font-medium text-brand-600 hover:underline"
                      >
                        Grafik
                      </a>
                      <button
                        type="button"
                        class="text-sm font-medium text-brand-600 hover:underline disabled:text-stone-400"
                        [disabled]="rowBusy() === e.id"
                        (click)="openEdit(e)"
                      >
                        Edytuj
                      </button>
                      <button
                        type="button"
                        class="text-sm font-medium text-rose-600 hover:underline disabled:text-stone-400"
                        [disabled]="rowBusy() === e.id"
                        (click)="onDelete(e)"
                      >
                        Usuń
                      </button>
                    } @else {
                      <button
                        type="button"
                        class="text-sm font-medium text-brand-600 hover:underline disabled:text-stone-400"
                        [disabled]="rowBusy() === e.id"
                        (click)="onReactivate(e)"
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
export default class BusinessEmployees {
  private readonly api = inject(ApiClient);

  protected readonly loading = signal(true);
  /** Błąd pobrania listy (retry ma sens) — osobno od serverError akcji zapisu/usuwania. */
  protected readonly loadError = signal<string | null>(null);
  protected readonly serverError = signal<string | null>(null);
  protected readonly employees = signal<Employee[]>([]);

  protected readonly formOpen = signal(false);
  protected readonly editingId = signal<string | null>(null);
  // blokuje podwójne kliknięcie akcji na wierszu (usuń/aktywuj)
  protected readonly rowBusy = signal<string | null>(null);

  protected readonly model = signal({ name: '', email: '' });

  protected readonly employeeForm = form(this.model, (p) => {
    // lustrzane do CreateEmployeeDto (#17)
    required(p.name, { message: 'Imię i nazwisko jest wymagane' });
    maxLength(p.name, 100, {
      message: 'Imię i nazwisko może mieć maksymalnie 100 znaków',
    });
    // email opcjonalny (bez required) — walidujemy format tylko gdy niepusty
    email(p.email, { message: 'Nieprawidłowy format adresu email' });
    pattern(p.email, EMAIL_WITH_TLD, {
      message: 'Nieprawidłowy format adresu email',
    });
  });

  constructor() {
    this.load();
  }

  /** Pobranie listy — osobny sygnał błędu niż akcje (serverError): tylko tu da się powtórzyć
   *  żądanie i tylko tu błąd zastępuje listę, zamiast wisieć nad formularzem. */
  protected load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    firstValueFrom(this.api.get<Employee[]>('/businesses/mine/employees'))
      .then((employees) => this.employees.set(employees))
      .catch((err: unknown) => {
        this.loadError.set('Nie udało się wczytać pracowników. ' + apiErrorMessage(err));
      })
      .finally(() => this.loading.set(false));
  }

  protected openCreate(): void {
    this.model.set({ name: '', email: '' });
    this.editingId.set(null);
    this.serverError.set(null);
    this.formOpen.set(true);
  }

  protected openEdit(e: Employee): void {
    this.model.set({ name: e.name, email: e.user?.email ?? '' });
    this.editingId.set(e.id);
    this.serverError.set(null);
    this.formOpen.set(true);
  }

  protected closeForm(): void {
    this.formOpen.set(false);
    this.editingId.set(null);
  }

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    await submitAuthForm(this.employeeForm, this.serverError, async () => {
      const m = this.model();
      // ponytail: puste opcjonalne pole pomijamy → odpięcie konta przy edycji
      // nie jest wspierane (poza MVP), jak opis w usługach
      const payload = { name: m.name, ...(m.email ? { email: m.email } : {}) };
      const id = this.editingId();
      if (id) {
        const updated = await firstValueFrom(
          this.api.patch<Employee>(`/businesses/mine/employees/${id}`, payload),
        );
        this.employees.update((list) =>
          list.map((e) => (e.id === id ? updated : e)),
        );
      } else {
        const created = await firstValueFrom(
          this.api.post<Employee>('/businesses/mine/employees', payload),
        );
        this.employees.update((list) =>
          [...list, created].sort((a, b) => a.name.localeCompare(b.name, 'pl')),
        );
      }
      this.closeForm();
    });
  }

  protected async onDelete(e: Employee): Promise<void> {
    // usuwanie nieodwracalne (pracownik bez rezerwacji znika na stałe) — potwierdzenie
    const ok = globalThis.confirm(
      `Usunąć pracownika „${e.name}"? Jeśli ma rezerwacje, zostanie dezaktywowany.`,
    );
    if (!ok) return;
    this.serverError.set(null);
    this.rowBusy.set(e.id);
    try {
      const res = await firstValueFrom(
        this.api.delete<DeleteResult>(`/businesses/mine/employees/${e.id}`),
      );
      if (res.deactivated) {
        // pracownik z rezerwacjami: dezaktywowany, zostaje na liście jako nieaktywny
        this.employees.update((list) =>
          list.map((x) => (x.id === e.id ? { ...x, isActive: false } : x)),
        );
      } else {
        this.employees.update((list) => list.filter((x) => x.id !== e.id));
      }
    } catch (err) {
      this.serverError.set(apiErrorMessage(err));
    } finally {
      this.rowBusy.set(null);
    }
  }

  protected async onReactivate(e: Employee): Promise<void> {
    this.serverError.set(null);
    this.rowBusy.set(e.id);
    try {
      const updated = await firstValueFrom(
        this.api.patch<Employee>(`/businesses/mine/employees/${e.id}`, {
          isActive: true,
        }),
      );
      this.employees.update((list) =>
        list.map((x) => (x.id === e.id ? updated : x)),
      );
    } catch (err) {
      this.serverError.set(apiErrorMessage(err));
    } finally {
      this.rowBusy.set(null);
    }
  }
}
