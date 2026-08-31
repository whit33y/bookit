import type { Business } from './business-response';

/**
 * Atrapa odpowiedzi `GET /businesses/mine` dla speków, które ustawień nie testują, a tylko
 * muszą domknąć żądanie i podać dane firmy (kafelek pulpitu #135 i sam pulpit #132).
 * Wzór jak `stats/testing-helpers.ts` — moduł pomocniczy obok kodu, nie plik `.spec.ts`.
 */
export const businessResponse = (
  overrides: Partial<Business> = {},
): Business => ({
  name: 'Salon Ola',
  description: 'Fryzjer damsko-męski',
  phone: '+48 500 600 700',
  street: 'Kwiatowa 1',
  city: 'Warszawa',
  postalCode: '00-001',
  lat: 52.23,
  lng: 21.01,
  cancellationHours: 24,
  ...overrides,
});
