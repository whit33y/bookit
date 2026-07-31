import { Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { NotificationsService } from './notifications.service';
import { RemindersService } from './reminders.service';

@Module({
  // MailService zostaje wewnątrz modułu — na zewnątrz wychodzi tylko NotificationsService,
  // żeby treści maili nie powstawały w feature'ach. PrismaModule jest @Global(), więc bez importu.
  // RemindersService jest providerem tylko po to, żeby ScheduleModule zobaczył jego @Cron —
  // nikt go nie wstrzykuje i nie wychodzi na zewnątrz, bo eksport publikowałby wyzwalacz
  // crona do ręcznego odpalania z dowolnego modułu.
  providers: [MailService, NotificationsService, RemindersService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
