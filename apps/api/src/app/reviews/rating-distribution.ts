/**
 * Rozkład ocen 1–5 firmy — histogram przy sekcji recenzji na profilu (#112). Osobno od
 * `ReviewStats`, bo tamten kształt jedzie też na karty wyszukiwarki (#34), a tam rozkład
 * ma nie wchodzić.
 */
export const RATINGS = [1, 2, 3, 4, 5] as const;

export type Rating = (typeof RATINGS)[number];

export type RatingDistribution = Record<Rating, number>;

/**
 * Wiersze z `groupBy({ by: ['rating'] })` uzupełnione o zera. Prisma nie zwraca stopni bez
 * ani jednej oceny, a front rysuje wszystkie pięć słupków — brakujący klucz byłby po jego
 * stronie dziurą do załatania przy każdym odczycie.
 *
 * Świeży obiekt na każde wywołanie, bez współdzielonej stałej `EMPTY_*` — wynik idzie prosto
 * do odpowiedzi HTTP, więc nie może być tą samą instancją co przy poprzednim żądaniu.
 */
export const toRatingDistribution = (
  rows: { rating: number; _count: { _all: number } }[],
): RatingDistribution => {
  const distribution = Object.fromEntries(RATINGS.map((rating) => [rating, 0])) as RatingDistribution;

  for (const row of rows) {
    // ocen spoza 1–5 pilnuje CHECK z migracji (#46); gdyby jakaś się przecisnęła, ma nie
    // dorobić szóstego klucza w odpowiedzi
    if ((RATINGS as readonly number[]).includes(row.rating)) {
      distribution[row.rating as Rating] = row._count._all;
    }
  }

  return distribution;
};

// Suma słupków = liczba wszystkich recenzji firmy. Stąd bierze się `total` listy, zamiast
// z osobnego `count` — patrz komentarz w ReviewsService.listForBusiness.
export const countRatings = (distribution: RatingDistribution): number =>
  RATINGS.reduce((sum, rating) => sum + distribution[rating], 0);
