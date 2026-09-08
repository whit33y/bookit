import { Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { translate } from '../../core/i18n/translate';
import { AuthStore } from '../../core/auth/auth-store';
import { FavoritesStore } from './favorites-store';

/**
 * Serce ulubionych (#182) — jedno na profilu firmy i jedno na każdej karcie wyniku
 * wyszukiwarki. Stan bierze z `FavoritesStore`, więc dwadzieścia serc na liście to nadal
 * jeden zbiór i zero dodatkowych żądań.
 *
 * Kogo tu nie ma: `OWNER`, `EMPLOYEE` i `ADMIN` nie widzą serca w ogóle. Nieaktywny przycisk
 * z wyjaśnieniem obiecywałby funkcję, której te role nie dostaną (CONTEXT.md → „Ulubiona
 * firma"), a backend i tak odpowiada im 403.
 *
 * Gość serce widzi i może w nie kliknąć — klik prowadzi na `/login` z celem powrotu, ten sam
 * wzorzec co finalizacja w kreatorze rezerwacji. Schowanie serca przed gościem ukrywałoby
 * funkcję, po którą wystarczy się zalogować.
 *
 * Dostępność: zwykły przycisk z etykietą opisującą akcję, którą klik wykona — bez
 * `aria-pressed`, żeby czytnik nie kazał użytkownikowi tłumaczyć sobie stanu na akcję.
 * Sam glif jest `aria-hidden`, a wypełnienie (nie tylko kolor) odróżnia stany, więc
 * informacji nie niesie wyłącznie barwa (WCAG 1.4.1).
 */
@Component({
  selector: 'app-favorite-heart',
  host: { class: 'inline-block' },
  template: `
    @if (visible()) {
      <button
        type="button"
        [attr.aria-label]="label()"
        [title]="label()"
        (click)="onClick()"
        class="grid h-9 w-9 place-items-center rounded-lg transition hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
        [class]="active() ? 'text-brand-700' : 'text-stone-500 hover:text-brand-700'"
      >
        <svg
          aria-hidden="true"
          class="h-5 w-5"
          viewBox="0 0 24 24"
          [attr.fill]="active() ? 'currentColor' : 'none'"
          stroke="currentColor"
          stroke-width="2"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z"
          />
        </svg>
      </button>
    }
  `,
})
export default class FavoriteHeart {
  readonly businessId = input.required<string>();

  private readonly auth = inject(AuthStore);
  private readonly favorites = inject(FavoritesStore);
  private readonly router = inject(Router);

  private readonly isGuest = computed(() => this.auth.user() === null);

  /** Gość i klient — reszta ról nie ma czego oznaczać. Regułę „kto ma ulubione" trzyma
   *  `FavoritesStore`, żeby nie stała w dwóch miejscach naraz. */
  protected readonly visible = computed(
    () => this.isGuest() || this.favorites.canHaveFavorites(),
  );

  protected readonly active = computed(() => this.favorites.isFavorite(this.businessId()));

  protected readonly label = computed(() =>
    translate(this.active() ? 'favorites.remove' : 'favorites.add'),
  );

  protected onClick(): void {
    if (this.isGuest()) {
      void this.router.navigate(['/login'], {
        queryParams: { returnUrl: this.router.url },
      });
      return;
    }
    void this.favorites.toggle(this.businessId());
  }
}
