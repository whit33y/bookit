import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types/auth-user';
import { BusinessesService } from './businesses.service';
import { CreateBusinessDto } from './dto/create-business.dto';
import { SearchBusinessesQueryDto } from './dto/search-businesses-query.dto';
import { UpdateBusinessDto } from './dto/update-business.dto';

@Controller('businesses')
export class BusinessesController {
  constructor(private readonly businessesService: BusinessesService) {}

  // publiczna wyszukiwarka — bez guardów (jak :slug); ścieżka bez parametru,
  // więc nie koliduje z 'mine' ani ':slug' niezależnie od kolejności
  @Get()
  search(@Query() query: SearchBusinessesQueryDto) {
    return this.businessesService.search(query);
  }

  // przed @Get(':slug') — inaczej trasa parametryczna złapie „mine"
  @Get('mine')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER)
  findMine(@CurrentUser() user: AuthUser) {
    return this.businessesService.findMine(user.sub);
  }

  // publiczny profil firmy — bez guardów (jak categories)
  @Get(':slug')
  findBySlug(@Param('slug') slug: string) {
    return this.businessesService.findBySlug(slug);
  }

  // ADMIN/EMPLOYEE odpadają na guardzie (403) — założenie firmy nadpisuje rolę,
  // a schemat ma jedno pole role, więc straciliby swoją. OWNER przechodzi
  // celowo: dopiero unikalny ownerId daje mu właściwe 409 „masz już firmę”.
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CLIENT, UserRole.OWNER)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBusinessDto) {
    return this.businessesService.create(user.sub, dto);
  }

  // tylko OWNER; firmę wskazuje ownerId z tokena, nie z body
  @Patch('mine')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER)
  updateMine(@CurrentUser() user: AuthUser, @Body() dto: UpdateBusinessDto) {
    return this.businessesService.updateMine(user.sub, dto);
  }
}
