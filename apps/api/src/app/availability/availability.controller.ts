import { Controller, Get, Param, Query } from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import { AvailabilityQueryDto } from './dto/availability-query.dto';
import { FirstSlotsQueryDto } from './dto/first-slots-query.dto';

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

  // Ponowna rezerwacja (#191): po jednym najwcześniejszym terminie na dzień w zakresie.
  // Osobna trasa, nie tryb tej wyżej — typ odpowiedzi nie ma zależeć od obecności query paramu.
  // Bez throttlera, jak reszta tras dostępności: koszt żądania ogranicza `MAX_RANGE_DAYS`
  // w serwisie (400 powyżej), więc nie da się go rozdmuchać jednym parametrem.
  @Get('first-slots')
  getFirstSlots(@Param('slug') slug: string, @Query() query: FirstSlotsQueryDto) {
    return this.availabilityService.getFirstSlots(slug, query);
  }
}
