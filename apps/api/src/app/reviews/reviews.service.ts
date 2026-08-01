import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BookingStatus, Prisma } from '@prisma/client';
import { parsePagination } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessReviewsQueryDto } from './dto/business-reviews-query.dto';
import { CreateReviewDto } from './dto/create-review.dto';
import { maskAuthor } from './review-author';
import { ReviewStats, toReviewStats } from './review-stats';

// kształt zwracany z POST /bookings/:id/review; bez clientId — to zawsze wystawiający
const reviewSelect = {
  id: true,
  bookingId: true,
  businessId: true,
  rating: true,
  comment: true,
  createdAt: true,
} satisfies Prisma.ReviewSelect;

// Publiczna lista recenzji. Nazwisko autora wchodzi tutaj wyłącznie po to, żeby maskAuthor zrobił
// z niego inicjał — z serwisu nie wychodzi ani ono, ani clientId (patrz mapowanie w listForBusiness).
const publicReviewSelect = {
  id: true,
  rating: true,
  comment: true,
  createdAt: true,
  client: { select: { firstName: true, lastName: true } },
} satisfies Prisma.ReviewSelect;

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, bookingId: string, dto: CreateReviewDto) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { clientId: true, businessId: true, status: true },
    });
    if (!booking) {
      throw new NotFoundException('Nie znaleziono rezerwacji');
    }
    // Cudza rezerwacja to 403, nie 404 — AC wprost tego wymaga, tak samo jak przy odwoływaniu
    // wizyty (BookingsService.transition).
    if (booking.clientId !== userId) {
      throw new ForbiddenException('Brak uprawnień');
    }
    if (booking.status !== BookingStatus.COMPLETED) {
      throw new ConflictException('Recenzję można wystawić dopiero po odbytej wizycie');
    }

    try {
      return await this.prisma.review.create({
        data: {
          bookingId,
          clientId: userId,
          // z rezerwacji, nie z body — inaczej dałoby się podpiąć ocenę pod obcą firmę
          businessId: booking.businessId,
          rating: dto.rating,
          comment: dto.comment ?? null,
        },
        select: reviewSelect,
      });
    } catch (e) {
      // O duplikacie rozstrzyga @unique bookingId, a nie select przed insertem: dwa równoległe
      // żądania przeszłyby oba pre-check, ale drugi insert i tak padnie na P2002.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Ta wizyta ma już recenzję');
      }
      throw e;
    }
  }

  async listForBusiness(slug: string, query: BusinessReviewsQueryDto) {
    // paginacja przed zapytaniem o firmę, tak jak w BusinessesService.search — zły `limit`
    // ma dać 400 niezależnie od tego, czy firma istnieje, i nie kosztować zapytania do bazy
    const { page, limit, skip } = parsePagination(query);

    // isBlocked w WHERE jak w BusinessesService.findBySlug → zablokowana i nieistniejąca firma
    // dają identyczne 404 (odczyt recenzji nie zdradza, że firma istnieje)
    const business = await this.prisma.business.findFirst({
      where: { slug, isBlocked: false },
      select: { id: true },
    });
    if (!business) {
      throw new NotFoundException('Nie znaleziono firmy');
    }

    const where: Prisma.ReviewWhereInput = { businessId: business.id };

    const [rows, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        select: publicReviewSelect,
        // najnowsze najpierw; id jako tiebreaker, bo seed wstawia paczkę recenzji z identycznym
        // createdAt, a bez deterministycznej kolejności ta sama recenzja wychodzi na dwóch stronach
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.review.count({ where }),
    ]);

    return {
      items: rows.map(({ client, ...review }) => ({ ...review, author: maskAuthor(client) })),
      total,
      page,
      limit,
    };
  }

  /**
   * Średnia i liczba ocen dla wielu firm naraz — jedno `groupBy` zamiast agregatu per firma,
   * bo wyszukiwarka (#34) potrzebuje tego dla całej strony wyników. Firmy bez recenzji nie wracają
   * z bazy w ogóle, więc brak klucza w mapie znaczy `EMPTY_REVIEW_STATS`.
   */
  async statsFor(businessIds: string[]): Promise<Map<string, ReviewStats>> {
    if (businessIds.length === 0) {
      return new Map();
    }

    const rows = await this.prisma.review.groupBy({
      by: ['businessId'],
      where: { businessId: { in: businessIds } },
      _avg: { rating: true },
      _count: { _all: true },
    });

    return new Map(
      rows.map((row) => [row.businessId, toReviewStats(row._avg.rating, row._count._all)]),
    );
  }
}
