import { Controller, Get, Param, Query } from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import { AvailabilityQueryDto } from './dto/availability-query.dto';

// Publiczne, bez guardów (jak GET /businesses/:slug i /categories) — klient wybiera termin
// przed zalogowaniem. Osobny controller od BusinessesController, tak jak WorkingHoursController
// dla tras zagnieżdżonych; inna głębokość ścieżki niż businesses/:slug, więc bez kolizji tras.
@Controller('businesses/:slug/availability')
export class AvailabilityController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  @Get()
  getSlots(@Param('slug') slug: string, @Query() query: AvailabilityQueryDto) {
    return this.availabilityService.getSlots(slug, query);
  }
}
