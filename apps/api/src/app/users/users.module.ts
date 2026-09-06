import { Module } from '@nestjs/common';
import { UserAvatarController } from './user-avatar.controller';
import { UserAvatarService } from './user-avatar.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController, UserAvatarController],
  providers: [UsersService, UserAvatarService],
})
export class UsersModule {}
