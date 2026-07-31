import { ValidationError } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { ApiErrorBody, DEFAULT_MESSAGES } from './api-error';
import { validationExceptionFactory } from './validation-exception.factory';

const body = (errors: ValidationError[]) =>
  validationExceptionFactory(errors).getResponse() as ApiErrorBody;

describe('validationExceptionFactory', () => {
  it('zwraca jeden polski komunikat i klucze ograniczeń zamiast angielskich zdań', () => {
    const result = body([
      {
        property: 'password',
        constraints: { minLength: 'password must be longer than 8', isString: 'x' },
      },
    ]);

    expect(result.message).toBe(DEFAULT_MESSAGES.VALIDATION_FAILED);
    expect(result.fields).toEqual([
      { field: 'password', constraints: ['minLength', 'isString'] },
    ]);
  });

  it('skleja ścieżkę pól zagnieżdżonych (SetWorkingHoursDto)', () => {
    const result = body([
      {
        property: 'slots',
        children: [
          {
            property: '0',
            children: [
              { property: 'startTime', constraints: { matches: 'zły format' } },
            ],
          },
        ],
      },
    ]);

    expect(result.fields).toEqual([
      { field: 'slots.0.startTime', constraints: ['matches'] },
    ]);
  });

  it('pomija poziomy bez własnych ograniczeń', () => {
    const result = body([
      {
        property: 'slots',
        constraints: { arrayMaxSize: 'za dużo' },
        children: [
          { property: '1', children: [{ property: 'endTime', constraints: { matches: 'x' } }] },
        ],
      },
    ]);

    expect(result.fields).toEqual([
      { field: 'slots', constraints: ['arrayMaxSize'] },
      { field: 'slots.1.endTime', constraints: ['matches'] },
    ]);
  });
});
