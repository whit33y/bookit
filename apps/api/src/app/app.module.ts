import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { AvailabilityModule } from './availability/availability.module';
import { BookingsModule } from './bookings/bookings.module';
import { BusinessesModule } from './businesses/businesses.module';
import { CategoriesModule } from './categories/categories.module';
import { EmployeesModule } from './employees/employees.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PrismaModule } from './prisma/prisma.module';
import { ServicesModule } from './services/services.module';
import { TimeOffsModule } from './time-offs/time-offs.module';
import { UsersModule } from './users/users.module';
import { WorkingHoursModule } from './working-hours/working-hours.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Jobs czasowe (#38 przypomnienia); bez forRoot() dekoratory @Cron nie są skanowane.
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    UsersModule,
    CategoriesModule,
    BusinessesModule,
    ServicesModule,
    EmployeesModule,
    WorkingHoursModule,
    TimeOffsModule,
    AvailabilityModule,
    BookingsModule,
    // Wchodzi też tranzytywnie (BookingsModule, AuthModule), ale wprost, żeby cron przypomnień
    // (#38) nie zniknął z grafu przy zmianie importów tamtych modułów. Nest instancjonuje
    // moduł raz, więc job nie dubluje się.
    NotificationsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
