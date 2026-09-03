import {
  Body,
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
import { AdminApplicationsQueryDto } from './dto/admin-applications-query.dto';
import { AdminBusinessesQueryDto } from './dto/admin-businesses-query.dto';
import { AdminUsersQueryDto } from './dto/admin-users-query.dto';
import { RejectApplicationDto } from './dto/reject-application.dto';

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

  // Kolejka zgłoszeń (#143) osobno od rejestru firm, a nie jako `?status=PENDING` na liście
  // wyżej: to dwa różne zadania administratora — kolejka jest pracą do wykonania i ma się
  // wyzerować, rejestr służy przeglądaniu. Decyzje siedzą pod tym samym prefiksem, żeby
  // adres mówił, czego dotyczą.
  @Get('business-applications')
  listApplications(@Query() query: AdminApplicationsQueryDto) {
    return this.adminService.listApplications(query);
  }

  // 200 zamiast domyślnego dla POST 201 — jak block/unblock, nic tu nie powstaje.
  @Post('business-applications/:id/approve')
  @HttpCode(HttpStatus.OK)
  approveApplication(@Param('id') id: string) {
    return this.adminService.approve(id);
  }

  // Jedyna decyzja z ciałem: odrzucenie bez powodu nie mówi zgłaszającemu, co poprawić.
  @Post('business-applications/:id/reject')
  @HttpCode(HttpStatus.OK)
  rejectApplication(@Param('id') id: string, @Body() dto: RejectApplicationDto) {
    return this.adminService.reject(id, dto);
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
