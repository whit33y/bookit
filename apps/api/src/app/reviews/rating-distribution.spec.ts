import { describe, expect, it } from 'vitest';
import { countRatings, toRatingDistribution } from './rating-distribution';

const row = (rating: number, count: number) => ({ rating, _count: { _all: count } });

describe('toRatingDistribution', () => {
  it('przepisuje liczby z groupBy na właściwe stopnie', () => {
    const result = toRatingDistribution([
      row(5, 25),
      row(4, 12),
      row(3, 4),
      row(2, 1),
      row(1, 3),
    ]);

    expect(result).toEqual({ 1: 3, 2: 1, 3: 4, 4: 12, 5: 25 });
  });

  it('stopnie bez ocen dostają zera, żaden klucz nie znika', () => {
    const result = toRatingDistribution([row(5, 7), row(4, 2)]);

    expect(result).toEqual({ 1: 0, 2: 0, 3: 0, 4: 2, 5: 7 });
  });

  it('firma bez recenzji → zera na każdym stopniu (AC: bez pomijania kluczy)', () => {
    expect(toRatingDistribution([])).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  });

  // ocen spoza 1–5 pilnuje CHECK z migracji — mapper i tak nie ma prawa dorobić szóstego klucza
  it('ocena spoza 1–5 nie tworzy dodatkowego klucza', () => {
    const result = toRatingDistribution([row(5, 1), row(0, 9), row(6, 9)]);

    expect(Object.keys(result)).toEqual(['1', '2', '3', '4', '5']);
    expect(result).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 });
  });

  it('każde wywołanie daje świeży obiekt — wynik idzie do odpowiedzi HTTP', () => {
    const first = toRatingDistribution([]);
    first[5] = 999;

    expect(toRatingDistribution([])[5]).toBe(0);
  });
});

describe('countRatings', () => {
  it('sumuje wszystkie stopnie', () => {
    expect(countRatings({ 1: 0, 2: 1, 3: 4, 4: 12, 5: 25 })).toBe(42);
  });

  it('same zera → 0', () => {
    expect(countRatings({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 })).toBe(0);
  });
});
