import { BusinessStatus } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { PaginationQuery } from '../../common/pagination';

// Query params przychodzą jako stringi (globalny ValidationPipe bez `transform: true`) — jak
// w SearchBusinessesQueryDto walidujemy tu wyłącznie kształt, zakresy page/limit liczy parsePagination.
export class AdminBusinessesQueryDto implements PaginationQuery {
  // fraza: nazwa firmy, miasto lub email właściciela
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  q?: string;

  // brak parametru = bez filtra, admin widzi zablokowane i niezablokowane razem
  @IsOptional()
  @IsIn(['true', 'false'], { message: 'blocked musi być true albo false' })
  blocked?: string;

  // Inaczej niż `blocked`: brak parametru nie znaczy „bez filtra", tylko APPROVED — rejestr
  // pokazuje firmy działające, a zgłoszenia mają własną kolejkę (#143). @IsEnum zamiast
  // @IsIn na stringach, bo to gotowy typ ze schematu — serwis czyta go wtedy bez rzutowania,
  // a nowy stan zgłoszenia nie wymaga pamiętania o tym pliku.
  @IsOptional()
  @IsEnum(BusinessStatus, {
    message: `status musi być jedną z wartości: ${Object.values(BusinessStatus).join(', ')}`,
  })
  status?: BusinessStatus;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'page musi być liczbą całkowitą' })
  page?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'limit musi być liczbą całkowitą' })
  limit?: string;
}
