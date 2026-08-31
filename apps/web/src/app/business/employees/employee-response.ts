/**
 * Lustro odpowiedzi `GET /businesses/mine/employees` (employeeSelect w findAll, #17).
 * Repo nie ma wspólnej libki DTO (patrz `core/api-client.ts`), więc kontrakt jest po stronie
 * web powielony ręcznie.
 *
 * Typy stoją osobno od `employees.ts`, bo czytają tę samą odpowiedź jeszcze dwa miejsca:
 * lista pracowników w formularzu usługi (`services.ts`) i kafelek pulpitu (#135).
 */

export interface LinkedUser {
  email: string;
  firstName: string | null;
  lastName: string | null;
}

export interface Employee {
  id: string;
  name: string;
  isActive: boolean;
  user: LinkedUser | null;
}
