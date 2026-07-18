import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { MailModule } from '../mail/mail.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [
    // global: JwtService dostępny w guardach innych modułów bez re-importu
    JwtModule.register({ global: true }),
    MailModule,
    // ponytail: in-memory storage per instancję — przy wielu replikach podmienić
    // na ThrottlerStorageRedis
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 5 }]),
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
