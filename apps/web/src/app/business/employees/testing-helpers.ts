import type { Employee } from './employee-response';

/**
 * Atrapa jednej pozycji z `GET /businesses/mine/employees` dla speków, które pracowników nie
 * testują, a tylko muszą domknąć żądanie i podać dane (kafelek pulpitu #135 i sam pulpit #132).
 * Wzór jak `stats/testing-helpers.ts` — moduł pomocniczy obok kodu, nie plik `.spec.ts`.
 */
export const employeeResponse = (
  overrides: Partial<Employee> = {},
): Employee => ({
  id: 'e1',
  name: 'Ola Nowak',
  isActive: true,
  user: null,
  ...overrides,
});
