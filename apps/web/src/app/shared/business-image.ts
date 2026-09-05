/**
 * Wizerunek firmy po stronie web (CONTEXT.md): logo firmy i okładka profilu.
 *
 * Bajty leżą w bazie i idą przez API (ADR-0001), więc obraz jest zwykłym URL-em do `<img>`,
 * a nie żądaniem przez `ApiClient`. Moduł stoi w `shared/`, bo czytają go ustawienia firmy
 * (#154) oraz profil publiczny i wyniki wyszukiwarki (#155) — wszystkie pod tym samym adresem.
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
 * Adres logo firmy albo `null`, gdy firma go nie ma (#155). Bierze całą firmę, a nie `id`
 * i wersję osobno: te pola i tak zawsze podróżują razem, a konsument nie ma wtedy jak pomylić
 * kolejności argumentów ani podstawić wersji okładki pod logo.
 */
export function businessLogoUrl(business: {
  id: string;
  logoVersion: string | null;
}): string | null {
  return businessImageUrl(business.id, 'logo', business.logoVersion);
}

/** Adres okładki profilu albo `null`, gdy firma jej nie ma (#155). */
export function businessCoverUrl(business: {
  id: string;
  coverVersion: string | null;
}): string | null {
  return businessImageUrl(business.id, 'cover', business.coverVersion);
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
