import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  isBusinessAvailable,
  publicBusinessWhere,
} from '../businesses/public-business';
import { PrismaService } from '../prisma/prisma.service';
import { EMPTY_REVIEW_STATS } from '../reviews/review-stats';
import { ReviewsService } from '../reviews/reviews.service';

// Karta na liście ulubionych pokazuje to samo co karta wyniku wyszukiwarki (#34) minus
// lat/lng — lista nie ma mapy. `status` i `isBlocked` schodzą z odpowiedzi: front dostaje
// z nich policzone `isAvailable`, żeby nie składał „firmy działającej" po swojej stronie.
const favoriteBusinessSelect = {
  id: true,
  slug: true,
  name: true,
  city: true,
  street: true,
  logoVersion: true,
  status: true,
  isBlocked: true,
  category: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.BusinessSelect;

@Injectable()
export class FavoritesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reviews: ReviewsService,
  ) {}

  /**
   * Dodanie do ulubionych. Idempotentne przez `skipDuplicates`, nie przez „sprawdź i wstaw":
   * dwie otwarte karty klikają serce równolegle, a drugi klik ma dać 204, nie 409.
   *
   * Firma spoza `publicBusinessWhere` → 404. Nie da się oznaczyć czegoś, czego się nie widzi —
   * inaczej klient dodałby do listy firmę odrzuconą albo zablokowaną, zgadując identyfikator.
   */
  async add(userId: string, businessId: string): Promise<void> {
    const business = await this.prisma.business.findFirst({
      where: { id: businessId, ...publicBusinessWhere },
      select: { id: true },
    });
    if (!business) {
      throw new NotFoundException('Nie znaleziono firmy');
    }

    await this.prisma.favoriteBusiness.createMany({
      data: { userId, businessId },
      skipDuplicates: true,
    });
  }

  /**
   * Usunięcie z ulubionych. `deleteMany`, nie `delete`: brak wiersza to stan docelowy, a nie
   * błąd — powtórzone kliknięcie serca oddaje 204 zamiast 404. `userId` w warunku pilnuje,
   * żeby nikt nie skasował cudzej zakładki.
   */
  async remove(userId: string, businessId: string): Promise<void> {
    await this.prisma.favoriteBusiness.deleteMany({ where: { userId, businessId } });
  }

  /**
   * Lista ulubionych, najnowsze pierwsze, bez paginacji: to kilkanaście pozycji jednego
   * klienta, a nie katalog.
   *
   * Świadomie **bez** `publicBusinessWhere` — firma, która przestała działać, zostaje na
   * liście wyszarzona z `isAvailable: false`. Wypadnięcie bez śladu wyglądałoby jak zgubiona
   * zakładka, a klient nie ma jak zdjąć serca z czegoś, czego nie widzi.
   */
  async list(userId: string) {
    const favorites = await this.prisma.favoriteBusiness.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { business: { select: favoriteBusinessSelect } },
    });

    const businesses = favorites.map((favorite) => favorite.business);
    const stats = await this.reviews.statsFor(businesses.map((business) => business.id));

    return businesses.map(({ status, isBlocked, ...business }) => ({
      ...business,
      // firma bez recenzji nie wraca z groupBy — dostaje avgRating: null, nie 0
      ...(stats.get(business.id) ?? EMPTY_REVIEW_STATS),
      isAvailable: isBusinessAvailable({ status, isBlocked }),
    }));
  }

  /**
   * Sam zbiór identyfikatorów — tym żądaniem front zapala serca w wyszukiwarce i na profilach
   * (ADR-0004). Osobno od `list`, bo leci raz na start sesji klienta, a pełna lista dopiero
   * przy wejściu na `/client/favorites`.
   *
   * Zwraca też firmy niedziałające: inaczej serce na profilu takiej firmy byłoby puste,
   * a na liście ulubionych zapalone.
   */
  async listIds(userId: string): Promise<{ ids: string[] }> {
    const favorites = await this.prisma.favoriteBusiness.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { businessId: true },
    });
    return { ids: favorites.map((favorite) => favorite.businessId) };
  }
}
