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
