import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types/auth-user';
import { BusinessesService } from './businesses.service';
import { CreateBusinessDto } from './dto/create-business.dto';

@Controller('businesses')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BusinessesController {
  constructor(private readonly businessesService: BusinessesService) {}

  // ADMIN/EMPLOYEE odpadają na guardzie (403) — założenie firmy nadpisuje rolę,
  // a schemat ma jedno pole role, więc straciliby swoją. OWNER przechodzi
  // celowo: dopiero unikalny ownerId daje mu właściwe 409 „masz już firmę”.
  @Post()
  @Roles(UserRole.CLIENT, UserRole.OWNER)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBusinessDto) {
    return this.businessesService.create(user.sub, dto);
  }
}
