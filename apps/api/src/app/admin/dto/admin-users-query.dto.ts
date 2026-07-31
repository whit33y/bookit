import { IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PaginationQuery } from '../../common/pagination';

// Jak AdminBusinessesQueryDto — tylko kształt, zakresy w serwisie.
export class AdminUsersQueryDto implements PaginationQuery {
  // fraza: email, imię lub nazwisko
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(['true', 'false'], { message: 'blocked musi być true albo false' })
  blocked?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'page musi być liczbą całkowitą' })
  page?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'limit musi być liczbą całkowitą' })
  limit?: string;
}
