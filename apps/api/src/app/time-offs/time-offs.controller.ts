import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types/auth-user';
import { CreateTimeOffDto } from './dto/create-time-off.dto';
import { TimeOffsService } from './time-offs.service';

// tylko OWNER; firmę wskazuje ownerId z tokena. Osobny controller od EmployeesController,
// żeby nie kolidować z pracą na employees.* — route :employeeId/time-offs nie zderza się z :id.
@Controller('businesses/mine/employees/:employeeId/time-offs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER)
export class TimeOffsController {
  constructor(private readonly timeOffsService: TimeOffsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Param('employeeId') employeeId: string) {
    return this.timeOffsService.list(user.sub, employeeId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Param('employeeId') employeeId: string,
    @Body() dto: CreateTimeOffDto,
  ) {
    return this.timeOffsService.create(user.sub, employeeId, dto);
  }

  @Delete(':timeOffId')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('employeeId') employeeId: string,
    @Param('timeOffId') timeOffId: string,
  ) {
    return this.timeOffsService.remove(user.sub, employeeId, timeOffId);
  }
}
