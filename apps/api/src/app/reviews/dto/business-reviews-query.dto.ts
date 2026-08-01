import { IsOptional, Matches } from 'class-validator';
import { PaginationQuery } from '../../common/pagination';

// Jak AdminUsersQueryDto — tylko kształt, zakresy rozstrzyga parsePagination w serwisie.
export class BusinessReviewsQueryDto implements PaginationQuery {
  @IsOptional()
  @Matches(/^\d+$/, { message: 'page musi być liczbą całkowitą' })
  page?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'limit musi być liczbą całkowitą' })
  limit?: string;
}
