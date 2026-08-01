/**
 * Agregat ocen firmy — ten sam kształt dokleja się do publicznego profilu (#11) i do karty
 * w wynikach wyszukiwarki (#34), więc front czyta go tak samo w obu miejscach.
 */
export interface ReviewStats {
  /**
   * Średnia zaokrąglona do jednego miejsca po przecinku (jak distanceKm w wyszukiwarce),
   * `null` gdy firma nie ma jeszcze recenzji. Świadomie nie 0 — AC #49 wprost zakazuje
   * atrapy „0.0" na karcie firmy bez ocen, a z zera nie da się odróżnić braku od najgorszej oceny.
   */
  avgRating: number | null;
  reviewCount: number;
}

export const EMPTY_REVIEW_STATS: ReviewStats = { avgRating: null, reviewCount: 0 };

// `_avg` z Prismy jest nullowalne niezależnie od `_count`, więc sprawdzamy oba warunki —
// przy braku ocen średnia nie ma sensu, a przy `null` nie ma czego zaokrąglać.
export const toReviewStats = (avg: number | null, count: number): ReviewStats => ({
  avgRating: avg !== null && count > 0 ? Math.round(avg * 10) / 10 : null,
  reviewCount: count,
});
