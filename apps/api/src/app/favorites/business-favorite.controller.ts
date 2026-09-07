import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types/auth-user';
import { FavoritesService } from './favorites.service';

/**
 * Zapis ulubionych siedzi pod `/businesses/:id/favorite`, bo to akcja na firmie — a odczyt
 * pod `/favorites`, bo tam zasobem jest lista klienta. Stąd dwa kontrolery jednego modułu.
 *
 * `@Roles(CLIENT)`: ulubione ma wyłącznie klient (CONTEXT.md → „Ulubiona firma"), więc
 * właściciel, pracownik i administrator dostają 403, a nie puste serce.
 *
 * Bez throttlera — inaczej niż przy wgrywaniu obrazów: to jeden wąski wiersz, więc klikanie
 * serca w kółko szkodzi tylko klikającemu.
 */
@Controller('businesses')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CLIENT)
export class BusinessFavoriteController {
  constructor(private readonly favorites: FavoritesService) {}

  // PUT, nie POST: „firma jest ulubiona" to stan docelowy, a nie kolejne zdarzenie do dopisania.
  // 204 bez ciała — front zna nowy stan serca, zanim wyśle żądanie.
  @Put(':id/favorite')
  @HttpCode(HttpStatus.NO_CONTENT)
  add(@CurrentUser() user: AuthUser, @Param('id') businessId: string) {
    return this.favorites.add(user.sub, businessId);
  }

  @Delete(':id/favorite')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id') businessId: string) {
    return this.favorites.remove(user.sub, businessId);
  }
}
