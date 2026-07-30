import { describe, expect, it } from 'vitest';
import { haversineDistanceKm } from './haversine';

describe('haversineDistanceKm', () => {
  it('liczy znany dystans Warszawa → Kraków (~252 km) z tolerancją ±5 km', () => {
    const result = haversineDistanceKm(52.2297, 21.0122, 50.0647, 19.945);

    expect(Math.abs(result - 252)).toBeLessThan(5);
  });

  it('zwraca 0 dla tego samego punktu (bez NaN z acos przy zaokrągleniach)', () => {
    const result = haversineDistanceKm(52.23, 21.01, 52.23, 21.01);

    expect(result).toBeCloseTo(0, 5);
  });

  it('1 stopień szerokości geograficznej na tej samej długości ≈ 111.2 km', () => {
    const result = haversineDistanceKm(0, 0, 1, 0);

    expect(Math.abs(result - 111.2)).toBeLessThan(1);
  });
});
