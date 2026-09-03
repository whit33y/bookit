import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PaginationQuery } from '../../common/pagination';

/**
 * Kolejka zgłoszeń (#143). Bez filtra `status`: kolejka z definicji pokazuje wyłącznie
 * PENDING — rozpatrzone zgłoszenia to już rejestr firm, pod `GET /admin/businesses`.
 * Bez `blocked` z tej samej strony: blokada dotyczy firm działających.
 */
export class AdminApplicationsQueryDto implements PaginationQuery {
  // fraza: nazwa firmy, miasto lub email zgłaszającego — jak w AdminBusinessesQueryDto
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'page musi być liczbą całkowitą' })
  page?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'limit musi być liczbą całkowitą' })
  limit?: string;
}
