import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink, type Route } from '@angular/router';
import { I18nStore } from '../../core/i18n/i18n-store';
import type { TranslationKey } from '../../core/i18n/pl';

interface FooterLink {
  /** Trasa wewnętrzna — zawsze przez `routerLink`, nigdy `href`. */
  path: string;
  labelKey: TranslationKey;
}

interface FooterColumn {
  /** Id nagłówka; `aria-labelledby` kolumny wskazuje na niego, więc etykieta ma jedno źródło. */
  id: string;
  titleKey: TranslationKey;
  /** Kolumna kontaktowa dopisuje na początku listy `mailto:` — jedyny odnośnik wychodzący. */
  mail?: boolean;
  links: FooterLink[];
}

/**
 * Pozycje stopki jako dane, nie jako sześć wypisanych anchorów: każda zmiana klas albo atrybutu
 * ARIA szłaby inaczej sześć razy. Świadomie bez zależności od roli — stopka to spis treści
 * serwisu, a nie druga nawigacja; „Panel firmy" widzi też gość i trafia na `/login` przez guarda,
 * dokładnie jak po wpisaniu adresu ręcznie.
 *
 * `/help` i `/faq` nie mają jeszcze tras, więc filtr niżej je dziś wycina — pozycje ożyją same,
 * kiedy strony powstaną, i to jest właśnie powód, żeby filtr był po konfiguracji routera,
 * a nie po ręcznej liście.
 */
const COLUMNS: FooterColumn[] = [
  {
    id: 'footer-clients',
    titleKey: 'footer.clients.title',
    links: [
      { path: '/search', labelKey: 'footer.clients.search' },
      { path: '/client', labelKey: 'footer.clients.myBookings' },
    ],
  },
  {
    id: 'footer-business',
    titleKey: 'footer.business.title',
    links: [
      { path: '/create-business', labelKey: 'footer.business.create' },
      { path: '/business', labelKey: 'footer.business.panel' },
    ],
  },
  {
    id: 'footer-contact',
    titleKey: 'footer.contact.title',
    mail: true,
    links: [
      { path: '/help', labelKey: 'footer.contact.help' },
      { path: '/faq', labelKey: 'footer.contact.faq' },
    ],
  },
];

const HEADING_CLASS =
  'mb-3 text-xs font-semibold uppercase tracking-wider text-stone-400';
const LINK_CLASS =
  'rounded text-sm text-stone-500 transition hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2';

/**
 * Czy w konfiguracji routera istnieje trasa dla podanej ścieżki.
 *
 * Patrzymy wyłącznie na pierwszy segment i wyłącznie na dosłowne dopasowanie: stopka linkuje do
 * wejść (`/business`, nie `/business/settings`), a trasy parametryczne (`:slug`) i wildcard (`**`)
 * dopasowałyby *każdą* ścieżkę — wtedy filtr przestałby cokolwiek wycinać i „Pomoc" wskazywałaby
 * na stronę 404. Dzieci tras leniwych (`loadChildren`) i tak nie są tu dostępne przed nawigacją.
 */
export function routeExists(config: Route[], path: string): boolean {
  const segment = path.replace(/^\/+/, '').split('/')[0];
  return config.some((route) => route.path === segment);
}

/**
 * Stopka aplikacji (#126). Wzorzec złożony z klocków design systemu: kreska i tło jak w pasku
 * nawigacji (§10), nagłówki kolumn jak caption z §2, pierścienie fokusu jak w §3.
 *
 * Renderowana globalnie w `app.html` pod `<main>`; wysokość pilnuje `app.css` (`main { flex: 1 }`
 * przy `min-height: 100dvh` na hoście), więc na krótkich stronach stopka siedzi przy dolnej
 * krawędzi bez żadnego dodatkowego CSS-a.
 */
@Component({
  selector: 'app-footer',
  imports: [RouterLink],
  template: `
    <footer
      [attr.aria-label]="i18n.t('footer.label')"
      class="border-t border-stone-200 bg-white"
    >
      <!-- ta sama miara i padding co pasek nawigacji w app.html — kolumny trzymają się siatki strony -->
      <div class="mx-auto max-w-7xl px-4 pt-10 pb-6 sm:px-6">
        <div class="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p class="mb-2 font-bold tracking-tight">BookIt</p>
            <p class="max-w-xs text-sm leading-relaxed text-stone-500">
              {{ i18n.t('footer.brand.tagline') }}
            </p>
          </div>

          @for (column of columns(); track column.id) {
            <nav [attr.aria-labelledby]="column.id">
              <h2 [id]="column.id" [class]="headingClass">
                {{ i18n.t(column.titleKey) }}
              </h2>
              <ul class="space-y-2">
                @if (column.mail) {
                  <li>
                    <a
                      [href]="mailtoHref()"
                      [attr.aria-label]="mailLabel()"
                      [class]="linkClass"
                      >{{ i18n.t('footer.contact.email') }}</a
                    >
                  </li>
                }
                @for (link of column.links; track link.path) {
                  <li>
                    <a [routerLink]="link.path" [class]="linkClass">{{
                      i18n.t(link.labelKey)
                    }}</a>
                  </li>
                }
              </ul>
            </nav>
          }
        </div>

        <div class="mt-8 border-t border-stone-200 pt-4 text-sm text-stone-500">
          {{ i18n.t('footer.copyright', { year }) }}
        </div>
      </div>
    </footer>
  `,
})
export default class Footer {
  protected readonly i18n = inject(I18nStore);
  private readonly router = inject(Router);

  protected readonly headingClass = HEADING_CLASS;
  protected readonly linkClass = LINK_CLASS;

  /** Rok liczony tutaj, nie zaszyty w tłumaczeniu — i nie w szablonie, gdzie `new Date()` nie istnieje. */
  protected readonly year = new Date().getFullYear();

  /** Kolumny bez ani jednej pozycji nie renderują nagłówka, który nie miałby czego opisywać. */
  protected readonly columns = computed(() => {
    const config = this.router.config;
    return COLUMNS.map((column) => ({
      ...column,
      links: column.links.filter((link) => routeExists(config, link.path)),
    })).filter((column) => column.mail || column.links.length > 0);
  });

  protected readonly mailtoHref = computed(
    () => `mailto:${this.i18n.t('footer.contact.email')}`,
  );

  protected readonly mailLabel = computed(() =>
    this.i18n.t('footer.contact.emailAria', {
      email: this.i18n.t('footer.contact.email'),
    }),
  );
}
