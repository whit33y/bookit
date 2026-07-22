import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types/auth-user';
import { SetWorkingHoursDto } from './dto/set-working-hours.dto';
import { WorkingHoursService } from './working-hours.service';

// tylko OWNER; firmę wskazuje ownerId z tokena. Osobny controller od EmployeesController,
// żeby nie kolidować z pracą #18 na employees.* — route :employeeId/working-hours nie zderza się z :id.
@Controller('businesses/mine/employees/:employeeId/working-hours')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER)
export class WorkingHoursController {
  constructor(private readonly workingHoursService: WorkingHoursService) {}

  @Get()
  get(@CurrentUser() user: AuthUser, @Param('employeeId') employeeId: string) {
    return this.workingHoursService.getSchedule(user.sub, employeeId);
  }

  // PUT = pełne zastąpienie grafiku (idempotentne), zwraca aktualny stan
  @Put()
  set(
    @CurrentUser() user: AuthUser,
    @Param('employeeId') employeeId: string,
    @Body() dto: SetWorkingHoursDto,
  ) {
    return this.workingHoursService.setSchedule(user.sub, employeeId, dto);
  }
}
