import { Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient, apiErrorMessage } from '../../core/api-client';
import { I18nStore } from '../../core/i18n/i18n-store';
import type { Employee } from '../employees/employee-response';
import CountPreview, { type PreviewItem } from './count-preview';
import DashboardTile, { type TileState } from './dashboard-tile';

/** Ile imion pokazuje próbka pod liczbą (#135: „3–4 imiona"). Cztery, bo pozycja jest
 *  jednowierszowa — kafelek usług mieści trzy, bo tam każda ma jeszcze cenę i czas. */
const EMPLOYEES_PREVIEW_LIMIT = 4;

/**
 * Kafelek pracowników na pulpicie firmy (#135): liczba aktywnych, liczba nieaktywnych osobno
 * i próbka imion.
 *
 * Nieaktywni idą własnym wierszem, a nie do wspólnej sumy: wizyty przyjmują tylko aktywni,
 * ale nieaktywny pracownik to ktoś, kto czeka na przywrócenie — liczba mówi, że jest co
 * przywracać. Gdy nieaktywnych nie ma, wiersz znika: „Nieaktywni: 0" nie jest informacją.
 *
 * Zero aktywnych pracowników to ostrzeżenie z CTA, nie „0": bez nich nie ma kto przyjąć
 * wizyty, więc klient niczego nie zarezerwuje, choćby usługi były.
 *
 * Kafelek jest tylko dla OWNER-a i nie sprawdza tego sam: renderuje go `dashboard.ts` pod tym
 * samym warunkiem, którym `business.routes.ts` chroni trasę (`roleGuard('OWNER')`), a endpoint
 * `GET /businesses/mine/employees` jest `@Roles(OWNER)`.
 */
@Component({
  selector: 'app-dashboard-employees-tile',
  imports: [DashboardTile, CountPreview],
  host: { class: 'block h-full' },
  template: `
    <app-dashboard-tile
      [heading]="i18n.t('businessDashboard.employees')"
      link="/business/employees"
      [state]="state()"
      [errorMessage]="serverError() ?? ''"
      [noticeTitle]="warning()"
      [noticeCta]="warningCta()"
      (retry)="onRetry()"
    >
      <app-dashboard-count-preview
        [headline]="i18n.plural('businessDashboard.employeesActive', count())"
        [note]="inactiveNote()"
        [items]="preview()"
      />
    </app-dashboard-tile>
  `,
})
export default class EmployeesTile {
  private readonly api = inject(ApiClient);
  protected readonly i18n = inject(I18nStore);

  protected readonly employees = signal<Employee[]>([]);
  protected readonly loading = signal(true);
  protected readonly serverError = signal<string | null>(null);

  private readonly active = computed(() =>
    this.employees().filter((employee) => employee.isActive),
  );

  protected readonly count = computed(() => this.active().length);

  private readonly inactiveCount = computed(
    () => this.employees().length - this.count(),
  );

  protected readonly inactiveNote = computed(() =>
    this.inactiveCount()
      ? this.i18n.t('businessDashboard.employeesInactive', {
          count: this.inactiveCount(),
        })
      : '',
  );

  /**
   * Ostrzeżenie niesie liczbę nieaktywnych, bo zastępuje cały podgląd — a właśnie przy zerze
   * aktywnych ta liczba waży najwięcej: mówi, że jest kogo przywrócić, zamiast zakładać nowego.
   * Wtedy zmienia się też zachęta, bo przywrócenie jest bliżej niż dodanie od zera.
   */
  protected readonly warning = computed(() =>
    this.inactiveCount()
      ? this.i18n.t('businessDashboard.employeesWarningInactive', {
          count: this.inactiveCount(),
        })
      : this.i18n.t('businessDashboard.employeesWarning'),
  );

  protected readonly warningCta = computed(() =>
    this.inactiveCount()
      ? this.i18n.t('businessDashboard.employeesCtaInactive')
      : this.i18n.t('businessDashboard.employeesCta'),
  );

  protected readonly preview = computed<PreviewItem[]>(() =>
    this.active()
      .slice(0, EMPLOYEES_PREVIEW_LIMIT)
      .map((employee) => ({ id: employee.id, primary: employee.name })),
  );

  // brak aktywnych pracowników to ostrzeżenie, nie „0" — AC #135
  protected readonly state = computed<TileState>(() => {
    if (this.loading()) return 'loading';
    if (this.serverError()) return 'error';
    return this.count() ? 'content' : 'warning';
  });

  constructor() {
    void this.load();
  }

  protected onRetry(): void {
    void this.load();
  }

  // bez strażnika wyścigu — patrz komentarz przy `load()` w calendar-tile.ts
  private async load(): Promise<void> {
    this.loading.set(true);
    this.serverError.set(null);
    try {
      const employees = await firstValueFrom(
        this.api.get<Employee[]>('/businesses/mine/employees'),
      );
      this.employees.set(employees);
    } catch (err) {
      this.serverError.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
