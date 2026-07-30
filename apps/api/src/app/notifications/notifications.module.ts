import { Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { NotificationsService } from './notifications.service';

@Module({
  // MailService zostaje wewnątrz modułu — na zewnątrz wychodzi tylko NotificationsService,
  // żeby treści maili nie powstawały w feature'ach. PrismaModule jest @Global(), więc bez importu.
  providers: [MailService, NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
