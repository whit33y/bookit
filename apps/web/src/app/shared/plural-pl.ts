/**
 * Polska odmiana rzeczownika po liczebniku: 1 opinia, 2–4 opinie, 5+ opinii.
 *
 * Wydzielone z `ui/rating-stars.ts`, bo rozkład ocen (#112) potrzebuje tej samej reguły dla
 * „gwiazdka/gwiazdki/gwiazdek". Pułapką są nastki — 12, 13, 14 kończą się cyfrą z zakresu 2–4,
 * ale biorą formę mnogą („12 opinii", nie „12 opinie"), więc kopiowanie warunku w drugie miejsce
 * to proszenie się o rozjazd.
 */
export function pluralPl(count: number, one: string, few: string, many: string): string {
  if (count === 1) return one;
  const lastTwo = count % 100;
  const last = count % 10;
  const isTeen = lastTwo >= 12 && lastTwo <= 14;
  return !isTeen && last >= 2 && last <= 4 ? few : many;
}
