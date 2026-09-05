import { Injectable, NotFoundException, PipeTransform } from '@nestjs/common';
import { BusinessImageKind } from '@prisma/client';
import { kindFromParam } from './business-image';

/**
 * `:kind` ze ścieżki na typ wyliczeniowy. Nieznany slot to nieistniejący zasób, nie błędne
 * dane wejściowe — stąd 404, ten sam co dla nieznanej trasy.
 */
@Injectable()
export class ParseImageKindPipe implements PipeTransform<string, BusinessImageKind> {
  transform(value: string): BusinessImageKind {
    const kind = kindFromParam(value);
    if (!kind) {
      throw new NotFoundException('Nie znaleziono obrazu');
    }
    return kind;
  }
}
