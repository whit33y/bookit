import { BadRequestException } from '@nestjs/common';
import { ValidationError } from 'class-validator';
import { ApiErrorField, DEFAULT_MESSAGES } from './api-error';

/** Ścieżka pola z zagnieżdżeniami — `slots.0.startTime` dla `SetWorkingHoursDto`. */
const flatten = (errors: ValidationError[], prefix = ''): ApiErrorField[] =>
  errors.flatMap((error) => {
    const field = prefix ? `${prefix}.${error.property}` : error.property;
    const constraints = Object.keys(error.constraints ?? {});
    return [
      ...(constraints.length ? [{ field, constraints }] : []),
      ...flatten(error.children ?? [], field),
    ];
  });

/**
 * Zamienia wynik `ValidationPipe` na kopertę `ApiErrorBody` (#45). Domyślnie Nest zwraca
 * `message: string[]` z angielskimi zdaniami class-validatora — front nie ma z nich pożytku
 * i nie może ich pokazać. Zamiast tego jeden polski komunikat + maszynowa lista pól.
 */
export const validationExceptionFactory = (errors: ValidationError[]) =>
  new BadRequestException({
    message: DEFAULT_MESSAGES.VALIDATION_FAILED,
    fields: flatten(errors),
  });
