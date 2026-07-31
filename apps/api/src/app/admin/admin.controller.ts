import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AdminService } from './admin.service';
import { AdminBusinessesQueryDto } from './dto/admin-businesses-query.dto';
import { AdminUsersQueryDto } from './dto/admin-users-query.dto';

// guardy na poziomie klasy — cała sekcja /admin jest wyłącznie dla ADMIN (bez tokena 401, zła rola 403)
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('businesses')
  listBusinesses(@Query() query: AdminBusinessesQueryDto) {
    return this.adminService.listBusinesses(query);
  }

  @Get('users')
  listUsers(@Query() query: AdminUsersQueryDto) {
    return this.adminService.listUsers(query);
  }

  // Moderacja firmy. Nic nie powstaje, więc 200 zamiast domyślnego dla POST 201 (jak
  // POST /bookings/:id/confirm). Brak body → brak DTO; nieistniejące id → 404 z serwisu.
  // Osobne block/unblock zamiast toggle'a z ciałem — operacja jest wtedy idempotentna,
  // a admin klikający dwa razy nie odblokowuje firmy przypadkiem.
  @Post('businesses/:id/block')
  @HttpCode(HttpStatus.OK)
  blockBusiness(@Param('id') id: string) {
    return this.adminService.block(id);
  }

  @Post('businesses/:id/unblock')
  @HttpCode(HttpStatus.OK)
  unblockBusiness(@Param('id') id: string) {
    return this.adminService.unblock(id);
  }
}
