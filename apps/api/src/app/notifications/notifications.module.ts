import { Module } from '@nestjs/common';
import { InAppNotificationsService } from './in-app.service';
import { MailService } from './mail.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { RemindersService } from './reminders.service';

@Module({
  // MailService i InAppNotificationsService zostają wewnątrz modułu — na zewnątrz wychodzi
  // tylko NotificationsService, żeby treści powiadomień nie powstawały w feature'ach.
  // PrismaModule jest @Global(), więc bez importu.
  // RemindersService jest providerem tylko po to, żeby ScheduleModule zobaczył jego @Cron —
  // nikt go nie wstrzykuje i nie wychodzi na zewnątrz, bo eksport publikowałby wyzwalacz
  // crona do ręcznego odpalania z dowolnego modułu.
  controllers: [NotificationsController],
  providers: [
    MailService,
    InAppNotificationsService,
    NotificationsService,
    RemindersService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
