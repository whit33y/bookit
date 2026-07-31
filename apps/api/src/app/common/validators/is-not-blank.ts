import { ValidationOptions, registerDecorator } from 'class-validator';

/** Wartość jest niepustym tekstem po obcięciu białych znaków. */
export const isNotBlank = (value: unknown): boolean =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * `@IsNotEmpty()` odrzuca tylko pusty string — `'   '` przechodzi i ląduje w bazie jako nazwa
 * firmy czy imię złożone z samych spacji (#45, przypadki brzegowe walidacji). Ten walidator
 * pilnuje pól, które użytkownik potem widzi na ekranie.
 *
 * Sama wartość nie jest przycinana: globalny `ValidationPipe` działa bez `transform: true`
 * (patrz komentarz w `search-businesses-query.dto.ts`), więc `@Transform` i tak nie doszłoby
 * do handlera.
 */
export function IsNotBlank(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isNotBlank',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate: (value: unknown) => isNotBlank(value),
        defaultMessage: () => 'Pole nie może być puste',
      },
    });
  };
}
