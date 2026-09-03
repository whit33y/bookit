import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { BusinessApplicationEventsService } from './business-application-events.service';

@Module({
  // NotificationsModule dla powiadomień o decyzji w sprawie zgłoszenia (#143) — moduł
  // eksportuje wyłącznie NotificationsService, więc treści powstają po tamtej stronie.
  imports: [NotificationsModule],
  controllers: [AdminController],
  providers: [AdminService, BusinessApplicationEventsService],
})
export class AdminModule {}
