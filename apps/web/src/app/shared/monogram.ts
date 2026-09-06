/**
 * Monogram (CONTEXT.md → „Wizerunek"): zastępnik pokazywany, gdy obrazu nie ma — inicjały
 * nazwy, gdy firma nie ma logo firmy ani okładki profilu, i inicjały imienia z nazwiskiem,
 * gdy osoba nie ma zdjęcia profilowego.
 *
 * Osobny moduł, a nie funkcja w `business-image.ts`: liczą go zarówno ścieżki wizerunku firmy,
 * jak i menu użytkownika (#161), a monogram osoby nie ma nic wspólnego z obrazami firmy.
 */

/** Inicjały nazwy — pierwsze litery maks. dwóch pierwszych słów (firma, pracownik). */
export function monogramInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('');
}

/**
 * Inicjały osoby — po jednej literze z imienia i z nazwiska, a nie z pierwszych dwóch słów
 * całości: „Anna Maria Kowalska" ma dać „AK", a nie „AM". Puste pola wypadają, więc konto
 * z samym imieniem dostaje jedną literę zamiast dziury.
 */
export function personMonogram(firstName: string, lastName: string): string {
  return [firstName, lastName]
    .map((part) => part.trim()[0] ?? '')
    .join('')
    .toUpperCase();
}

/**
 * Monogram z podpisu recenzji („Anna K." → „AK"). Podpis autora przychodzi z API już
 * zamaskowany, więc imię i nazwisko nie stoją w osobnych polach — bierzemy pierwsze i ostatnie
 * słowo, a nie dwa pierwsze: „Anna Maria K." ma dać „AK", tak samo jak `personMonogram` w menu
 * konta. Inaczej ta sama osoba miałaby przy recenzji inny monogram niż nad swoimi ustawieniami.
 */
export function signatureMonogram(signature: string): string {
  const words = signature.split(/\s+/).filter(Boolean);
  return personMonogram(words[0] ?? '', words.length > 1 ? words[words.length - 1] : '');
}
