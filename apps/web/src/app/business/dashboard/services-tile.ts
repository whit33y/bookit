import { Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient, apiErrorMessage } from '../../core/api-client';
import { I18nStore } from '../../core/i18n/i18n-store';
import { translate } from '../../core/i18n/translate';
import { formatPricePln } from '../../shared/price-pln.pipe';
import type { Service } from '../services/service-response';
import CountPreview, { type PreviewItem } from './count-preview';
import DashboardTile, { type TileState } from './dashboard-tile';

/** Ile usług pokazuje próbka pod liczbą (#135: „3 usługi z ceną i czasem trwania"). */
const SERVICES_PREVIEW_LIMIT = 3;

/**
 * Kafelek usług na pulpicie firmy (#135): liczba aktywnych usług i próbka kilku z nich
 * z ceną i czasem trwania.
 *
 * Liczy i pokazuje wyłącznie usługi aktywne. Nieaktywna usługa nie jest ofertą — nie da się
 * jej zarezerwować, więc wliczona zawyżałaby to, co firma ma w sprzedaży. Rozróżnienie
 * aktywnych i nieaktywnych zostaje na `/business/services`, gdzie da się je aktywować.
 * (Kafelek pracowników pokazuje nieaktywnych osobno, bo tam liczy się, ilu ludzi jest poza
 * obiegiem; nieaktywna usługa takiego znaczenia nie ma.)
 *
 * Zero aktywnych usług to ostrzeżenie z CTA, nie „0" i nie pusta lista: bez usług klient nie
 * ma czego zarezerwować, więc firma jest wtedy niedziałająca, a nie po prostu pusta.
 *
 * Kafelek jest tylko dla OWNER-a i nie sprawdza tego sam: renderuje go `dashboard.ts` pod tym
 * samym warunkiem, którym `business.routes.ts` chroni trasę (`roleGuard('OWNER')`), a endpoint
 * `GET /businesses/mine/services` jest `@Roles(OWNER)`.
 */
@Component({
  selector: 'app-dashboard-services-tile',
  imports: [DashboardTile, CountPreview],
  host: { class: 'block h-full' },
  template: `
    <app-dashboard-tile
      [heading]="i18n.t('businessDashboard.services')"
      link="/business/services"
      [state]="state()"
      [errorMessage]="serverError() ?? ''"
      [noticeTitle]="i18n.t('businessDashboard.servicesWarning')"
      [noticeCta]="i18n.t('businessDashboard.servicesCta')"
      (retry)="onRetry()"
    >
      <app-dashboard-count-preview
        [headline]="i18n.plural('businessDashboard.servicesActive', count())"
        [items]="preview()"
      />
    </app-dashboard-tile>
  `,
})
export default class ServicesTile {
  private readonly api = inject(ApiClient);
  protected readonly i18n = inject(I18nStore);

  protected readonly services = signal<Service[]>([]);
  protected readonly loading = signal(true);
  protected readonly serverError = signal<string | null>(null);

  private readonly active = computed(() =>
    this.services().filter((service) => service.isActive),
  );

  protected readonly count = computed(() => this.active().length);

  /** Formatowanie w `computed()`, nie w szablonie — dzięki temu próbka przelicza się też po
   *  zmianie języka (czyta `translate` i `Intl`, oba reaktywne na sygnał locale, #57). */
  protected readonly preview = computed<PreviewItem[]>(() =>
    this.active()
      .slice(0, SERVICES_PREVIEW_LIMIT)
      .map((service) => ({
        id: service.id,
        primary: service.name,
        // ten sam wiersz „czas · cena", którym opisuje usługę `/business/services`
        secondary: translate('services.meta', {
          minutes: service.durationMin,
          price: formatPricePln(service.priceCents),
        }),
      })),
  );

  // brak aktywnych usług to ostrzeżenie, nie „0" — AC #135
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
      const services = await firstValueFrom(
        this.api.get<Service[]>('/businesses/mine/services'),
      );
      this.services.set(services);
    } catch (err) {
      this.serverError.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
