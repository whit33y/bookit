import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { UserAvatarController } from './user-avatar.controller';
import { UserAvatarService } from './user-avatar.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  // #167: zmiana adresu e-mail pisze na stary adres — treść powstaje w notifications,
  // users zna tylko NotificationsService
  imports: [NotificationsModule],
  controllers: [UsersController, UserAvatarController],
  providers: [UsersService, UserAvatarService],
})
export class UsersModule {}
