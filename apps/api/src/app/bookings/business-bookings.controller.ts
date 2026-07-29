import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types/auth-user';
import { BookingsService } from './bookings.service';
import { BusinessBookingsQueryDto } from './dto/business-bookings-query.dto';

// Osobny kontroler od BookingsController (inny base path niż `bookings`) — jak
// EmployeesController/AvailabilityController dla innych tras zagnieżdżonych pod businesses/mine.
// OWNER i EMPLOYEE oboje mogą wejść; kto widzi co, rozstrzyga serwis (#31).
@Controller('businesses/mine/bookings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER, UserRole.EMPLOYEE)
export class BusinessBookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Get()
  findForBusiness(@CurrentUser() user: AuthUser, @Query() query: BusinessBookingsQueryDto) {
    return this.bookingsService.findForBusiness(user, query);
  }
}
