/**
 * Zdjęcie profilowe po stronie web (CONTEXT.md → „Wizerunek"): obraz osoby stojącej za kontem.
 *
 * Osobno od `business-image.ts`, mimo bliźniaczego kształtu adresu: firma ma logo firmy, osoba
 * ma zdjęcie profilowe i te dwa obrazy nigdy nie dzielą nazwy ani slotu. Nazwa pliku idzie
 * za tabelą `UserImage` z API, żeby nie mylił się z komponentem sekcji (`account/profile-photo.ts`). Bajty idą przez API
 * (ADR-0001), więc obraz jest zwykłym URL-em do `<img>`, a nie żądaniem przez `ApiClient`.
 *
 * W adresie zostaje backendowe `avatar` (#163) — to segment trasy, nie nazwa pojęcia.
 */

/** Ten sam prefiks, co `ApiClient.base` — `<img src>` omija HttpClient, więc musi go mieć wprost. */
const API_BASE = '/api';

/**
 * Adres zdjęcia profilowego albo `null`, gdy osoba go nie ma (wtedy zostaje monogram).
 *
 * Bierze całego użytkownika, a nie `id` i wersję osobno — te pola zawsze podróżują razem,
 * a wersja w query stringu jest cache-busterem: odpowiedź jest `immutable` na rok, więc bez
 * niej właściciel konta oglądałby stare zdjęcie do wyczyszczenia cache przeglądarki.
 */
export function profilePhotoUrl(user: {
  id: string;
  avatarVersion: string | null;
}): string | null {
  return user.avatarVersion === null
    ? null
    : `${API_BASE}/users/${user.id}/avatar?v=${encodeURIComponent(user.avatarVersion)}`;
}
