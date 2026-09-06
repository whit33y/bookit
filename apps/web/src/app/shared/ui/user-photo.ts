import { Component, computed, input, signal } from '@angular/core';

/**
 * Zdjęcie profilowe osoby (CONTEXT.md → „Wizerunek") z monogramem jako stanem domyślnym.
 * Jeden komponent na wszystkie trzy miejsca, w których osoba pokazuje twarz: menu użytkownika
 * (#161), ustawienia konta (#164) i recenzje na profilu firmy (#165) — bo to za każdym razem
 * ta sama decyzja, a nie trzy warianty wyglądu.
 *
 * Bliźniak `business-logo.ts`, ale osobny komponent: firma ma logo firmy, osoba ma zdjęcie
 * profilowe, monogram liczy się z innych pól, a przy braku obrazu **i** monogramu zostaje ikona
 * sylwetki, której wizerunek firmy nie zna. Nazwa idzie za `user-image.ts` (adres), nie za
 * `account/profile-photo.ts` — tamto jest sekcją ustawień, ta rzecz jest kafelkiem.
 *
 * Monogram przychodzi policzony z zewnątrz — inaczej niż w `business-logo.ts`, gdzie kafelek
 * dostaje nazwę firmy i liczy go sam. Powód jest w danych: menu i ustawienia konta mają imię
 * i nazwisko osobno (`personMonogram`), a recenzja ma już tylko zamaskowany podpis „Anna K.",
 * z którego nazwisko nie wróci. Kafelek, który miałby to pogodzić, musiałby przyjmować obie
 * postacie naraz.
 *
 * Rozmiar, zaokrąglenie i kolory monogramu przychodzą z zewnątrz (`class` na hoście): menu ma
 * kółko 7, ustawienia kwadrat 24, recenzje kółko 10. Host jest za to zawsze `shrink-0`, więc lista
 * recenzji nie „skacze" między autorami ze zdjęciem i bez, ani w trakcie wczytywania obrazu.
 *
 * Świadomie bez `NgOptimizedImage` (mimo reguły z FRONTEND_CLAUDE.md), z tego samego powodu co
 * w `business-logo.ts`: to nie jest statyczny zasób o znanych z góry wymiarach, tylko bajty spod
 * `/api` pod adresem z cache-busterem, a o stabilność układu dba host, nie atrybuty obrazka.
 */
@Component({
  selector: 'app-user-photo',
  host: { class: 'grid shrink-0 place-items-center overflow-hidden' },
  template: `
    @if (showImage()) {
      <img
        [src]="src()"
        [alt]="alt()"
        [attr.aria-hidden]="alt() ? null : 'true'"
        class="h-full w-full object-cover"
        loading="lazy"
        decoding="async"
        (error)="onError()"
      />
    } @else if (monogram(); as initials) {
      <span aria-hidden="true">{{ initials }}</span>
    } @else {
      <!-- ani zdjęcia, ani monogramu: konto bez imienia i nazwiska albo profil, który jeszcze
           nie wrócił z API. Inicjały z adresu e-mail udawałyby wtedy dane, których nie mamy. -->
      <svg
        aria-hidden="true"
        class="h-1/2 w-1/2"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="2"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
        />
      </svg>
    }
  `,
})
export default class UserPhoto {
  /** `null` = konto nie ma zdjęcia (patrz `profilePhotoUrl`), więc rysujemy monogram. */
  readonly src = input<string | null>(null);
  /** Monogram osoby — gotowe inicjały; `''` (brak danych) spycha kafelek na ikonę sylwetki. */
  readonly monogram = input('');
  /**
   * Pusty alt (domyślnie) chowa obraz przed czytnikiem ekranu — tak jest w menu i przy
   * recenzji, gdzie czyje to zdjęcie, mówi już etykieta przycisku albo podpis obok. Opis
   * podajemy tam, gdzie obraz stoi sam: w ustawieniach konta.
   */
  readonly alt = input('');

  /** Adres, pod którym obrazek się nie wczytał — trzymamy adres, a nie flagę, żeby kolejne
   *  zdjęcie (inny autor na tej samej pozycji listy, wgranie nowego pliku) dostało własną szansę. */
  private readonly failedSrc = signal<string | null>(null);

  // 404 zdarza się realnie: zdjęcie można usunąć między pobraniem recenzji a pobraniem bajtów.
  // Wtedy wracamy do monogramu, zamiast zostawić w kafelku ikonę zepsutego obrazka.
  protected readonly showImage = computed(
    () => this.src() !== null && this.src() !== this.failedSrc(),
  );

  protected onError(): void {
    this.failedSrc.set(this.src());
  }
}
