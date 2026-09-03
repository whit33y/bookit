/**
 * Hasło startowe dla konta zakładanego przez administratora (#146).
 *
 * Bez znaków, które mylą się przy przepisywaniu z kartki albo przez telefon (`0`/`O`,
 * `1`/`l`/`I`) — hasło z założenia wędruje poza systemem, więc czytelność jest tu warta
 * więcej niż dwa dodatkowe znaki alfabetu.
 */
const ALPHABET =
  'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!?@#$%';

/** Powyżej minimum backendu (8 znaków), bo hasła nikt tu nie wymyśla ani nie zapamiętuje —
 *  długość nic nie kosztuje, a hasło żyje do pierwszego logowania. */
export const GENERATED_PASSWORD_LENGTH = 16;

/** Największa wielokrotność długości alfabetu mieszcząca się w Uint32 — losowania powyżej
 *  odrzucamy, bo samo `% ALPHABET.length` faworyzowałoby początkowe znaki alfabetu. */
const REJECT_ABOVE =
  Math.floor(2 ** 32 / ALPHABET.length) * ALPHABET.length - 1;

/** `crypto.getRandomValues`, nie `Math.random`: hasło do konta administratora nie może
 *  pochodzić z generatora przewidywalnego z jednej próbki. */
export function generatePassword(): string {
  const chars: string[] = [];
  while (chars.length < GENERATED_PASSWORD_LENGTH) {
    const values = crypto.getRandomValues(
      new Uint32Array(GENERATED_PASSWORD_LENGTH),
    );
    for (const value of values) {
      if (value <= REJECT_ABOVE && chars.length < GENERATED_PASSWORD_LENGTH) {
        chars.push(ALPHABET[value % ALPHABET.length]);
      }
    }
  }
  return chars.join('');
}
