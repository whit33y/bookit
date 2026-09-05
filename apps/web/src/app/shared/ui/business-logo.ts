import { Component, computed, input, signal } from '@angular/core';
import { monogramInitials } from '../business-image';

/**
 * Kwadratowy znak firmy przy jej nazwie (CONTEXT.md → „Logo firmy") z monogramem jako stanem
 * domyślnym. Jeden komponent na profil i na kartę wyniku, bo to ta sama decyzja: firma bez
 * logo nie pokazuje pustej ramki, tylko inicjały na ciemnym tle.
 *
 * Rozmiar i zaokrąglenie przychodzą z zewnątrz (`class` na hoście) — profil ma 20/24, karta
 * wyniku 14 — ale kafelek jest zawsze `shrink-0` i o stałych wymiarach, więc lista wyników nie
 * „skacze" między firmami z obrazem i bez, ani w trakcie wczytywania obrazu.
 *
 * Świadomie bez `NgOptimizedImage` (mimo reguły z FRONTEND_CLAUDE.md): ta dyrektywa jest do
 * zasobów statycznych o znanych z góry wymiarach i wymaga `width`/`height` na elemencie.
 * Tutaj bajty idą z API pod adresem z cache-busterem, a rozmiar wynika z kafelka, nie z pliku
 * — o stabilność układu dba więc `shrink-0` i stała wysokość hosta, nie atrybuty obrazka.
 */
@Component({
  selector: 'app-business-logo',
  host: { class: 'grid shrink-0 place-items-center overflow-hidden bg-stone-900 text-white' },
  template: `
    @if (showImage()) {
      <!-- alt to sama nazwa firmy (AC #155): „logo firmy X" dokłada czytnikowi ekranu słowo
           o rodzaju pliku, a nie o tym, co obrazek przedstawia. Monogram odwrotnie: to
           zastępnik wizualny, więc jest aria-hidden i nazwę niesie sam sąsiedni nagłówek. -->
      <img
        [src]="src()"
        [alt]="name()"
        class="h-full w-full object-cover"
        [attr.loading]="eager() ? null : 'lazy'"
        decoding="async"
        (error)="onError()"
      />
    } @else {
      <span aria-hidden="true">{{ initials() }}</span>
    }
  `,
})
export default class BusinessLogo {
  readonly name = input.required<string>();
  /** `null` = firma nie ma logo (patrz `businessLogoUrl`), więc rysujemy monogram. */
  readonly src = input<string | null>(null);
  /** Profil ma logo nad linią zgięcia — lista wyników nie, więc domyślnie leniwie. */
  readonly eager = input(false);

  /** Adres, pod którym obrazek się nie wczytał — trzymamy adres, a nie flagę, żeby kolejne
   *  logo (inna firma na tej samej pozycji listy, podmiana pliku) dostało własną szansę. */
  private readonly failedSrc = signal<string | null>(null);

  // 404 zdarza się realnie: obraz można usunąć między pobraniem profilu a pobraniem bajtów.
  // Wtedy wracamy do monogramu, zamiast zostawić w kafelku ikonę zepsutego obrazka.
  protected readonly showImage = computed(
    () => this.src() !== null && this.src() !== this.failedSrc(),
  );

  protected readonly initials = computed(() => monogramInitials(this.name()));

  protected onError(): void {
    this.failedSrc.set(this.src());
  }
}
