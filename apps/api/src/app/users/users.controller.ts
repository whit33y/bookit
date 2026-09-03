import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AllowedDuringPasswordChange } from '../common/decorators/password-change.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types/auth-user';
import { UpdateMeDto } from './dto/update-me.dto';
import { UsersService } from './users.service';

// RolesGuard jest no-opem bez @Roles — tu demonstruje reużywalny stos guardów
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // Otwarte dla konta z wymuszoną zmianą hasła (#144) — front musi wiedzieć, kim jest
  // zalogowany i co ma zrobić. PATCH już nie: edycja profilu to „cokolwiek innego".
  @Get('me')
  @AllowedDuringPasswordChange()
  getMe(@CurrentUser() user: AuthUser) {
    return this.usersService.getMe(user.sub);
  }

  @Patch('me')
  patchMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    return this.usersService.updateMe(user.sub, dto);
  }
}
