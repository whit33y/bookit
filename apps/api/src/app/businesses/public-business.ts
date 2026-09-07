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

/**
 * Ten sam warunek policzony na już wczytanym wierszu. Potrzebuje go lista ulubionych (#181):
 * pokazuje również firmy, które przestały działać, wyszarzone — więc nie filtruje przez
 * `publicBusinessWhere`, ale musi powiedzieć frontowi to samo, co ten predykat.
 * Czyta wartości z `publicBusinessWhere`, a nie własne literały: „firma działająca" zostaje
 * jednym pojęciem, które da się zmienić w jednym miejscu.
 */
export const isBusinessAvailable = (business: {
  isBlocked: boolean;
  status: BusinessStatus;
}) =>
  business.isBlocked === publicBusinessWhere.isBlocked &&
  business.status === publicBusinessWhere.status;
