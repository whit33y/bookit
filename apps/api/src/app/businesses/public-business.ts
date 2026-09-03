import { BusinessStatus, Prisma } from '@prisma/client';

/**
 * „Firma działająca" (CONTEXT.md) — warunek dla wszystkich ścieżek publicznych: wyszukiwarki (#34), profilu po
 * slugu, dostępności terminów i zakładania rezerwacji. Dwie niezależne osie w jednym miejscu —
 * `status` mówi, czy administrator w ogóle wpuścił firmę (#141), `isBlocked` czy jej potem
 * nie ukarał (#41). Trzymane poza `businesses.service.ts`, bo korzystają z tego także moduły,
 * które ten serwis importuje (recenzje) — import w drugą stronę zamknąłby cykl.
 */
export const publicBusinessWhere = {
  isBlocked: false,
  status: BusinessStatus.APPROVED,
} satisfies Prisma.BusinessWhereInput;

/**
 * To samo dla zapytania Haversine, które idzie surowym SQL-em (alias tabeli `b`). Parametr
 * rzutujemy na typ wyliczeniowy, a nie kolumnę na tekst: porównanie zostaje wtedy sargable,
 * więc indeks `Business_status_idx` nadal się liczy.
 */
export const publicBusinessSql = Prisma.sql`b."isBlocked" = false AND b."status" = ${BusinessStatus.APPROVED}::"BusinessStatus"`;
