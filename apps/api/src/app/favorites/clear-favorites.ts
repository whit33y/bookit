import { Prisma } from '@prisma/client';

/**
 * Kasowanie ulubionych przy wyjściu z roli CLIENT (#181, ADR-0004). Wywoływane z transakcji,
 * w której zmienia się rola — awans z pozostawionymi wierszami dałby dane, do których nie
 * prowadzi żadna ścieżka w aplikacji.
 *
 * Osobna funkcja poza `FavoritesService`, tym samym wzorcem co `publicBusinessWhere`:
 * wołają ją `admin.service.ts` (akceptacja zgłoszenia firmy) i `employees.service.ts`
 * (przypięcie konta jako pracownika), a wstrzykiwanie im całego serwisu ulubionych
 * dopisałoby zależność do modułu, z którego potrzebują jednego `deleteMany`.
 */
export const clearFavorites = (tx: Prisma.TransactionClient, userId: string) =>
  tx.favoriteBusiness.deleteMany({ where: { userId } });
