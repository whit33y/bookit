import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiErrorBody, DEFAULT_MESSAGES } from '../errors/api-error';
import { validationExceptionFactory } from '../errors/validation-exception.factory';
import { ApiExceptionFilter } from './api-exception.filter';

/** Minimalny host Express — filtr używa wyłącznie status().json(). */
function capture(exception: unknown): { statusCode: number; body: ApiErrorBody } {
  const json = vi.fn<(body: ApiErrorBody) => void>();
  const status = vi.fn<(code: number) => { json: typeof json }>(() => ({ json }));
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;

  new ApiExceptionFilter().catch(exception, host);

  return { statusCode: status.mock.calls[0][0], body: json.mock.calls[0][0] };
}

describe('ApiExceptionFilter', () => {
  // 5xx logujemy ze stackiem — tu wyciszone, asercje w teście „loguje 5xx…"
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined) as typeof logSpy;
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('przepuszcza polski komunikat naszego wyjątku i dokłada kod', () => {
    const { statusCode, body } = capture(new NotFoundException('Nie znaleziono firmy'));

    expect(statusCode).toBe(404);
    expect(body).toEqual({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Nie znaleziono firmy',
    });
  });

  it('mapuje status na kod maszynowy', () => {
    expect(capture(new ConflictException('Wybrany termin jest już zajęty')).body.code).toBe(
      'CONFLICT',
    );
    expect(capture(new ForbiddenException('Brak uprawnień')).body.code).toBe('FORBIDDEN');
  });

  it('zamienia wyjątek spoza HttpException na 500 bez wycieku treści', () => {
    const { statusCode, body } = capture(
      new Error('Prisma: relation "Business" does not exist'),
    );

    expect(statusCode).toBe(500);
    expect(body).toEqual({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: DEFAULT_MESSAGES.INTERNAL_ERROR,
    });
    expect(JSON.stringify(body)).not.toContain('Prisma');
  });

  it('loguje 5xx, a 4xx nie', () => {
    capture(new Error('boom'));
    expect(logSpy).toHaveBeenCalledTimes(1);

    logSpy.mockClear();
    capture(new NotFoundException('Nie znaleziono firmy'));
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('podmienia angielskie domyślki frameworka na polski komunikat', () => {
    // InternalServerErrorException bez argumentu → 'Internal server error'
    expect(capture(new InternalServerErrorException()).body.message).toBe(
      DEFAULT_MESSAGES.INTERNAL_ERROR,
    );
    // trasa spoza kontrolerów
    expect(capture(new NotFoundException('Cannot GET /api/nie-ma')).body.message).toBe(
      DEFAULT_MESSAGES.NOT_FOUND,
    );
    // ThrottlerGuard
    expect(
      capture(new HttpException('ThrottlerException: Too Many Requests', 429)).body,
    ).toEqual({
      statusCode: 429,
      code: 'TOO_MANY_REQUESTS',
      message: DEFAULT_MESSAGES.TOO_MANY_REQUESTS,
    });
  });

  it('przepisuje błąd walidacji z listą pól', () => {
    const exception = validationExceptionFactory([
      { property: 'email', constraints: { isEmail: 'email must be an email' } },
    ]);

    const { statusCode, body } = capture(exception);

    expect(statusCode).toBe(400);
    expect(body).toEqual({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      message: DEFAULT_MESSAGES.VALIDATION_FAILED,
      fields: [{ field: 'email', constraints: ['isEmail'] }],
    });
  });

  it('nie robi z 409 błędu walidacji, nawet gdy payload niesie fields', () => {
    const { body } = capture(
      new ConflictException({
        message: 'Wybrany termin jest już zajęty',
        fields: [{ field: 'startsAt', constraints: ['taken'] }],
      }),
    );

    expect(body).toEqual({
      statusCode: 409,
      code: 'CONFLICT',
      message: 'Wybrany termin jest już zajęty',
    });
  });

  it('nie udaje walidacji przy zwykłym 400 z komunikatem', () => {
    const { body } = capture(new BadRequestException('startsAt musi być w przyszłości'));

    expect(body.code).toBe('BAD_REQUEST');
    expect(body.fields).toBeUndefined();
  });
});
