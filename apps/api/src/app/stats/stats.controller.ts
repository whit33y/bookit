import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types/auth-user';
import { BusinessStatsQueryDto } from './dto/business-stats-query.dto';
import { StatsService } from './stats.service';

// Kolejna trasa zagnieżdżona pod businesses/mine (jak employees, services, bookings).
// Tylko OWNER: to przekrój całej firmy — przychód i obłożenie wszystkich pracowników,
// a nie widok własnych wizyt, więc EMPLOYEE (który wchodzi na kalendarz #31) tu nie ma czego szukać.
@Controller('businesses/mine/stats')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER)
export class BusinessStatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get()
  findForBusiness(@CurrentUser() user: AuthUser, @Query() query: BusinessStatsQueryDto) {
    return this.statsService.findForBusiness(user.sub, query);
  }
}
