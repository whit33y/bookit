import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types/auth-user';
import { NotificationsQueryDto } from './dto/notifications-query.dto';
import { InAppNotificationsService } from './in-app.service';

// Bez @Roles: powiadomienia in-app (#54) ma każda zalogowana rola — klient dostaje decyzje
// firmy, właściciel nowe i odwołane rezerwacje. Odbiorcę bierzemy z tokena, nigdy ze ścieżki,
// więc nie ma tu czego autoryzować poza „zalogowany" (wzorem UsersController).
@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotificationsController {
  constructor(private readonly notifications: InAppNotificationsService) {}

  /** Osobno od listy, bo to ten endpoint odpytuje polling dzwoneczka co minutę. */
  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.notifications.unreadCount(user.sub);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: NotificationsQueryDto) {
    return this.notifications.list(user.sub, query);
  }

  // POST, nie PATCH — to akcja na zasobie, jak POST /bookings/:id/confirm, a nie edycja pól
  @Post(':id/read')
  markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notifications.markRead(user.sub, id);
  }

  // Nad `:id/read` nie stoi, bo prefiksy się nie pokrywają („read-all" nie wpada w „:id/read")
  @Post('read-all')
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user.sub);
  }
}
