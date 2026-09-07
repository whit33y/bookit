import { Controller, Get, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types/auth-user';
import { FavoritesService } from './favorites.service';

/**
 * Odczyt ulubionych klienta. Właściciela listy bierzemy z tokena, nigdy ze ścieżki — cudzych
 * ulubionych nie da się przeczytać, bo nie ma trasy, która by o nie pytała.
 */
@Controller('favorites')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CLIENT)
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  // Nad `@Get()` nie stoi żadna trasa parametryczna, ale kolejność zostaje jak w
  // NotificationsController: krótkie ścieżki stałe przed listą.
  @Get('ids')
  listIds(@CurrentUser() user: AuthUser) {
    return this.favorites.listIds(user.sub);
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.favorites.list(user.sub);
  }
}
