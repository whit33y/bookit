import type { Service } from './service-response';

/**
 * Atrapa jednej pozycji z `GET /businesses/mine/services` dla speków, które usług nie testują,
 * a tylko muszą domknąć żądanie i podać dane (kafelek pulpitu #135 i sam pulpit #132).
 * Wzór jak `stats/testing-helpers.ts` — moduł pomocniczy obok kodu, nie plik `.spec.ts`.
 *
 * `services.spec.ts` zostaje przy własnej atrapie: tam kształt usługi niesie treść asercji
 * (zaliczki, pracownicy), więc czyta się lepiej u siebie w pliku.
 */
export const serviceResponse = (overrides: Partial<Service> = {}): Service => ({
  id: 's1',
  name: 'Strzyżenie',
  description: null,
  durationMin: 30,
  priceCents: 8000,
  isActive: true,
  depositType: null,
  depositValue: null,
  employees: [],
  ...overrides,
});
