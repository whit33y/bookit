import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AllowedDuringPasswordChange } from '../common/decorators/password-change.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthUser } from '../common/types/auth-user';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  ResetPasswordDto,
} from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('forgot-password')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.forgotPassword(dto);
    return { message: 'Jeśli konto istnieje, wysłaliśmy link do resetu hasła' };
  }

  // Zalogowany zmienia sobie hasło — inaczej niż reset-password, który identyfikuje
  // użytkownika tokenem z maila. Otwarte dla konta z wymuszoną zmianą hasła (#144),
  // bo to jedyne wyjście z tego stanu.
  @Post('change-password')
  @HttpCode(200)
  // Throttler jak przy pozostałych trasach hasłowych: `currentPassword` jest polem do
  // zgadywania, więc limit obowiązuje mimo tokenu.
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @AllowedDuringPasswordChange()
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(user.sub, dto);
  }

  @Post('reset-password')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto);
    return { message: 'Hasło zostało zmienione' };
  }
}
