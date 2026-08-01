import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types/auth-user';
import { CreateReviewDto } from './dto/create-review.dto';
import { ReviewsService } from './reviews.service';

// Recenzja jest podzasobem rezerwacji, stąd ścieżka pod `bookings` — jak /bookings/:id/cancel.
// Kontroler mimo to należy do ReviewsModule: moduł idzie za domeną, nie za prefiksem
// (tak samo BusinessBookingsController serwuje /businesses/mine/bookings z BookingsModule).
//
// Zestaw ról jak przy POST /bookings — właściciel i pracownik też bywają czyimś klientem,
// a schemat ma jedno pole role. Że to jego własna wizyta, sprawdza serwis (403).
@Controller('bookings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CLIENT, UserRole.OWNER, UserRole.EMPLOYEE)
export class BookingReviewController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post(':id/review')
  create(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateReviewDto,
  ) {
    return this.reviewsService.create(user.sub, id, dto);
  }
}
