/**
 * Wizerunek firmy po stronie web (CONTEXT.md): logo firmy i okładka profilu.
 *
 * Bajty leżą w bazie i idą przez API (ADR-0001), więc obraz jest zwykłym URL-em do `<img>`,
 * a nie żądaniem przez `ApiClient`. Moduł stoi w `shared/`, bo dziś czytają go ustawienia firmy
 * (#154), a monogram — także profil publiczny; obrazy na samym profilu i w wynikach
 * wyszukiwarki to osobne zadania, które podepną się pod ten sam adres.
 */

/** Slot wizerunku — segment ścieżki `/businesses/:id/images/:kind`, lustro `IMAGE_SLOTS` z API. */
export type BusinessImageKind = 'logo' | 'cover';

/** Ten sam prefiks, co `ApiClient.base` — `<img src>` omija HttpClient, więc musi go mieć wprost. */
const API_BASE = '/api';

/**
 * Adres obrazu z cache-busterem. Odpowiedź jest `immutable` na rok (ADR-0001), więc bez wersji
 * w query stringu właściciel po wgraniu nowego logo oglądałby stare aż do wyczyszczenia cache.
 * `null` w wersji znaczy „firma nie ma tego obrazu" — wtedy nie ma czego pokazać (monogram).
 */
export function businessImageUrl(
  businessId: string,
  kind: BusinessImageKind,
  version: string | null,
): string | null {
  return version === null
    ? null
    : `${API_BASE}/businesses/${businessId}/images/${kind}?v=${encodeURIComponent(version)}`;
}

/**
 * Inicjały do monogramu — pierwsze litery maks. dwóch pierwszych słów nazwy. Ta sama funkcja
 * liczy zastępnik firmy i zastępnik pracownika, bo w obu miejscach to ten sam zabieg na nazwie.
 */
export function monogramInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('');
}
