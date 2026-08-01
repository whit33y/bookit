import { describe, expect, it } from 'vitest';
import { EMPTY_REVIEW_STATS, toReviewStats } from './review-stats';

describe('toReviewStats', () => {
  it('zaokrągla średnią do jednego miejsca po przecinku', () => {
    expect(toReviewStats(4.666666666666667, 3)).toEqual({ avgRating: 4.7, reviewCount: 3 });
  });

  it('ocena całkowita zostaje liczbą całkowitą', () => {
    expect(toReviewStats(5, 1)).toEqual({ avgRating: 5, reviewCount: 1 });
  });

  it('brak recenzji → avgRating null, nie 0 (AC #49: bez atrapy „0.0")', () => {
    expect(toReviewStats(null, 0)).toEqual(EMPTY_REVIEW_STATS);
  });

  // _avg z Prismy jest nullowalne niezależnie od _count — wtedy zostaje sama liczba ocen
  it('null w średniej mimo niezerowego count → avgRating null', () => {
    expect(toReviewStats(null, 2)).toEqual({ avgRating: null, reviewCount: 2 });
  });

  it('EMPTY_REVIEW_STATS to zero ocen bez średniej', () => {
    expect(EMPTY_REVIEW_STATS).toEqual({ avgRating: null, reviewCount: 0 });
  });
});
