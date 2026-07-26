import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types/auth-user';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';

@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  // Rezerwuje każdy zalogowany człowiek: właściciel i pracownik też bywają czyimś klientem,
  // a schemat ma jedno pole role, więc nie mają „drugiej" roli CLIENT. ADMIN odpada
  // na guardzie — to konto moderacyjne, nie klienckie. clientId zawsze z tokena, nie z body.
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CLIENT, UserRole.OWNER, UserRole.EMPLOYEE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBookingDto) {
    return this.bookingsService.create(user.sub, dto);
  }

  // Decyzje firmy. Guardy per-handler, bo POST /bookings wyżej ma inny zestaw ról.
  // Rolę odsiewa RolesGuard (403), przynależność rezerwacji do firmy — serwis (też 403).
  // Nic nie powstaje, więc 200 zamiast domyślnego dla POST 201. Brak body → brak DTO.
  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER)
  confirm(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookingsService.confirm(user.sub, id);
  }

  @Post(':id/decline')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER)
  decline(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookingsService.decline(user.sub, id);
  }

  // Odwołanie przez klienta. Role te same co przy POST /bookings — kto może zarezerwować,
  // ten musi móc odwołać własną wizytę; że rezerwacja jest jego, sprawdza serwis po
  // clientId (403). Polityka godzinowa firmy → 409.
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CLIENT, UserRole.OWNER, UserRole.EMPLOYEE)
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookingsService.cancel(user.sub, id);
  }

  // Odwołanie przez firmę — osobna ścieżka, bo ustawia inny status i nie podlega polityce.
  @Post(':id/cancel-by-business')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER)
  cancelByBusiness(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookingsService.cancelByBusiness(user.sub, id);
  }
}
