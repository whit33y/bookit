import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { parsePagination } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { AdminBusinessesQueryDto } from './dto/admin-businesses-query.dto';
import { AdminUsersQueryDto } from './dto/admin-users-query.dto';

// dane potrzebne do moderacji: właściciel (kontakt), status blokady, daty i skala działalności;
// bez lat/lng i opisu — tabela admina ich nie pokazuje
const adminBusinessSelect = {
  id: true,
  slug: true,
  name: true,
  city: true,
  street: true,
  isBlocked: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, name: true, slug: true } },
  owner: { select: { id: true, email: true, firstName: true, lastName: true } },
  _count: { select: { services: true, employees: true, bookings: true } },
} satisfies Prisma.BusinessSelect;

// jawny select bez passwordHash — jak profileSelect w UsersService; business mówi adminowi,
// czy user jest właścicielem firmy i czy ta firma jest już zablokowana
const adminUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  role: true,
  isBlocked: true,
  createdAt: true,
  business: { select: { id: true, slug: true, name: true, isBlocked: true } },
} satisfies Prisma.UserSelect;

// brak parametru → brak klucza isBlocked w where (obie grupy razem); DTO dopuszcza tylko 'true'/'false'
const blockedFilter = (blocked?: string) =>
  blocked === undefined ? {} : { isBlocked: blocked === 'true' };

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  // W przeciwieństwie do publicznej wyszukiwarki (#34) listy admina nie wymuszają isBlocked:false —
  // moderacja musi widzieć również to, co zablokowane.
  async listBusinesses(query: AdminBusinessesQueryDto) {
    const { page, limit, skip } = parsePagination(query);
    const where: Prisma.BusinessWhereInput = {
      ...blockedFilter(query.blocked),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { city: { contains: query.q, mode: 'insensitive' } },
              { owner: { email: { contains: query.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.business.findMany({
        where,
        select: adminBusinessSelect,
        orderBy: { createdAt: 'desc' }, // najnowsze zgłoszenia najpierw — one wymagają uwagi
        skip,
        take: limit,
      }),
      this.prisma.business.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async listUsers(query: AdminUsersQueryDto) {
    const { page, limit, skip } = parsePagination(query);
    const where: Prisma.UserWhereInput = {
      ...blockedFilter(query.blocked),
      ...(query.q
        ? {
            OR: [
              { email: { contains: query.q, mode: 'insensitive' } },
              { firstName: { contains: query.q, mode: 'insensitive' } },
              { lastName: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: adminUserSelect,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items, total, page, limit };
  }
}
