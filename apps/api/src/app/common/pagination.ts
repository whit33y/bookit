import { BadRequestException } from '@nestjs/common';

// Query params przychodzą jako stringi — globalny ValidationPipe nie ma `transform: true`
// (patrz komentarz w create-business.dto.ts), więc DTO walidują tylko kształt (`/^\d+$/`),
// a przeliczenie na liczby i zakresy robi ten helper.
export interface PaginationQuery {
  page?: string;
  limit?: string;
}

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
// DTO dopuszcza dowolnie długi ciąg cyfr — bez górnej granicy Number() przepełnia się do Infinity
export const MAX_PAGE = 100_000;

export interface Pagination {
  page: number;
  limit: number;
  skip: number;
}

export const parsePagination = (
  query: PaginationQuery,
  { defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT } = {},
): Pagination => {
  const page = query.page !== undefined ? Number(query.page) : 1;
  const limit = query.limit !== undefined ? Number(query.limit) : defaultLimit;
  // Number.isInteger odsiewa NaN — porównania z NaN są zawsze false, więc bez tego
  // nienumeryczne page/limit (DTO bez @Matches) doleciałoby do Prismy jako skip: NaN → 500
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) {
    throw new BadRequestException(`page poza zakresem 1..${MAX_PAGE}`);
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
    throw new BadRequestException(`limit poza zakresem 1..${maxLimit}`);
  }
  return { page, limit, skip: (page - 1) * limit };
};
