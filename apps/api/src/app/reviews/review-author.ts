/**
 * Podpis autora na publicznej liście recenzji: imię + inicjał nazwiska (AC #47). Recenzje czyta
 * każdy, również bez logowania, więc pełne nazwisko nie może opuścić serwisu — maskujemy przy
 * mapowaniu wyniku, nie po stronie klienta.
 *
 * Nazwisko złożone z samych białych znaków traktujemy jak brak i zostawiamy samo imię — inaczej
 * podpis kończyłby się osieroconą kropką.
 */
export const maskAuthor = ({
  firstName,
  lastName,
}: {
  firstName: string;
  lastName: string;
}): string => {
  const initial = lastName.trim().charAt(0).toUpperCase();
  const name = firstName.trim();
  return initial ? `${name} ${initial}.` : name;
};

/**
 * Autor recenzji tak, jak wychodzi z API: podpis plus to, czym front zaadresuje zdjęcie
 * profilowe (#165). Trzy pola razem, a nie trzy pola obok siebie w recenzji — `id` i wersja
 * mają sens wyłącznie jako para adresująca `GET /users/:id/avatar`, a bez `name` nie ma
 * z czego złożyć monogramu.
 */
export interface ReviewAuthor {
  /**
   * Publikujemy je świadomie: publiczny odczyt zdjęcia inaczej nie ma jak zostać zaadresowany,
   * a uuid nic nie zdradza ponad to, co i tak widać obok — imię autora recenzji.
   */
  id: string;
  /** Imię z inicjałem nazwiska — patrz `maskAuthor`. */
  name: string;
  /** `null` = konto bez zdjęcia profilowego, czyli monogram po stronie frontu. */
  avatarVersion: string | null;
}

/** Wiersz klienta → autor recenzji. Nazwisko kończy się tutaj: dalej jedzie sam inicjał. */
export const toReviewAuthor = ({
  id,
  firstName,
  lastName,
  avatarVersion,
}: {
  id: string;
  firstName: string;
  lastName: string;
  avatarVersion: string | null;
}): ReviewAuthor => ({ id, name: maskAuthor({ firstName, lastName }), avatarVersion });
