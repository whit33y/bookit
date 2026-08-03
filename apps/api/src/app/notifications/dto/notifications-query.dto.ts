import { IsOptional, Matches } from 'class-validator';
import { PaginationQuery } from '../../common/pagination';

// page/limit zostają stringami — globalny ValidationPipe nie ma `transform: true`, więc DTO
// pilnuje tylko kształtu, a zakresy sprawdza parsePagination (patrz common/pagination.ts).
export class NotificationsQueryDto implements PaginationQuery {
  @IsOptional()
  @Matches(/^\d+$/, { message: 'page musi być liczbą całkowitą' })
  page?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'limit musi być liczbą całkowitą' })
  limit?: string;
}
