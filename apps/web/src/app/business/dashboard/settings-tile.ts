import { Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient, apiErrorMessage } from '../../core/api-client';
import { I18nStore } from '../../core/i18n/i18n-store';
import type { Business } from '../settings/business-response';
import DashboardTile, { type TileState } from './dashboard-tile';

/** Adres w jednej linii: „Kwiatowa 1, 00-001 Warszawa". Kod pocztowy jest opcjonalny, więc
 *  składamy z tego, co jest — bez niego zostaje „Kwiatowa 1, Warszawa", a nie podwójny
 *  przecinek ani wiszące spacje. */
function oneLineAddress(business: Business): string {
  const place = [business.postalCode, business.city].filter(Boolean).join(' ');
  return [business.street, place].filter(Boolean).join(', ');
}

/**
 * Kafelek ustawień firmy na pulpicie (#135): nazwa, adres, telefon i polityka odwołań —
 * dane, po których właściciel poznaje, że profil jest ten i taki, jak myśli.
 *
 * To jedyny z trzech kafelków #135 bez `CountPreview`: pokazuje pola jednej firmy, a nie
 * liczbę i próbkę zbioru, więc wspólny byłby tylko import.
 *
 * Brak telefonu albo opisu daje jedną delikatną podpowiedź na dole — świadomie bez wskaźnika
 * kompletności profilu i bez ostrzeżenia: firma z takim profilem nadal przyjmuje rezerwacje,
 * więc to podpowiedź, a nie awaria (inaczej niż brak usług czy pracowników).
 *
 * Opisu kafelek nie wyświetla (to akapit, nie linijka), ale o jego brak dopytuje — profil bez
 * opisu widzi klient w wyszukiwarce.
 *
 * Kafelek jest tylko dla OWNER-a i nie sprawdza tego sam: renderuje go `dashboard.ts` pod tym
 * samym warunkiem, którym `business.routes.ts` chroni trasę (`roleGuard('OWNER')`).
 */
@Component({
  selector: 'app-dashboard-settings-tile',
  imports: [DashboardTile],
  host: { class: 'block h-full' },
  template: `
    <app-dashboard-tile
      [heading]="i18n.t('businessDashboard.settings')"
      link="/business/settings"
      [state]="state()"
      [errorMessage]="serverError() ?? ''"
      (retry)="onRetry()"
    >
      @if (business(); as data) {
        <p class="truncate font-semibold">{{ data.name }}</p>
        <p class="mt-1 truncate text-stone-600">{{ address() }}</p>
        @if (data.phone) {
          <p class="truncate text-stone-600">{{ data.phone }}</p>
        }
        <p class="text-stone-600">{{ cancellation() }}</p>

        @if (hint(); as text) {
          <p class="mt-3 text-stone-500">{{ text }}</p>
        }
      }
    </app-dashboard-tile>
  `,
})
export default class SettingsTile {
  private readonly api = inject(ApiClient);
  protected readonly i18n = inject(I18nStore);

  protected readonly business = signal<Business | null>(null);
  protected readonly loading = signal(true);
  protected readonly serverError = signal<string | null>(null);

  protected readonly address = computed(() => {
    const data = this.business();
    return data ? oneLineAddress(data) : '';
  });

  protected readonly cancellation = computed(() => {
    const hours = this.business()?.cancellationHours ?? 0;
    // 0 h to nie „do 0 godzin przed" — to brak okna, czyli odwołanie do ostatniej chwili
    return hours
      ? this.i18n.t('businessDashboard.settingsCancellation', { hours })
      : this.i18n.t('businessDashboard.settingsCancellationAnytime');
  });

  /** Jedno zdanie zamiast dwóch podpowiedzi pod sobą — kafelek ma podpowiadać, nie strofować. */
  protected readonly hint = computed(() => {
    const data = this.business();
    if (!data) return '';
    // `?.trim()`, bo pole złożone z samych spacji przechodzi walidację, a informacją nie jest
    const noPhone = !data.phone?.trim();
    const noDescription = !data.description?.trim();
    if (noPhone && noDescription)
      return this.i18n.t('businessDashboard.settingsHintBoth');
    if (noPhone) return this.i18n.t('businessDashboard.settingsHintPhone');
    if (noDescription)
      return this.i18n.t('businessDashboard.settingsHintDescription');
    return '';
  });

  // stanu pustego nie ma: panel firmy istnieje tylko dla firmy, która już jest założona
  protected readonly state = computed<TileState>(() => {
    if (this.loading()) return 'loading';
    if (this.serverError()) return 'error';
    return 'content';
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
      const business = await firstValueFrom(
        this.api.get<Business>('/businesses/mine'),
      );
      this.business.set(business);
    } catch (err) {
      this.serverError.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
