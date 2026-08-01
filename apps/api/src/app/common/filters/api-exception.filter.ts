import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiErrorBody,
  ApiErrorField,
  DEFAULT_MESSAGES,
  codeForStatus,
} from '../errors/api-error';

/** Domyślki Nesta/throttlera — po angielsku, więc nie mogą trafić do polskiego UI. Bez argumentu
 *  `HttpException` wstawia jako komunikat nazwę statusu („Internal Server Error"), guardy własne
 *  stałe. Nasze wyjątki niosą polskie komunikaty i przechodzą dalej bez zmian. */
const FRAMEWORK_MESSAGES = new Set([
  'bad request',
  'unauthorized',
  'forbidden',
  'forbidden resource',
  'not found',
  'conflict',
  'too many requests',
  'throttlerexception: too many requests',
  'internal server error',
]);

/** Trasa spoza kontrolerów: „Cannot GET /api/nie-ma". */
const UNKNOWN_ROUTE = /^Cannot [A-Z]+ \//;

const isFrameworkMessage = (message: string): boolean =>
  FRAMEWORK_MESSAGES.has(message.toLowerCase()) || UNKNOWN_ROUTE.test(message);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * Sprowadza każdy wyjątek do jednej koperty `ApiErrorBody` (#45, AC „spójny kształt odpowiedzi
 * błędu"). Bez niego w obiegu były trzy różne kształty (nasz `HttpException`, tablica komunikatów
 * z `ValidationPipe`, gołe 500), a angielskie domyślki frameworka wyciekały do polskiego UI.
 *
 * Wyjątki spoza `HttpException` (np. błąd Prismy) logujemy ze stackiem, ale na zewnątrz wychodzi
 * wyłącznie ogólny komunikat — treść błędu potrafi zdradzić strukturę bazy.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const body = this.toBody(exception);

    if (body.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        exception instanceof Error ? exception.message : String(exception),
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ApiErrorBody {
    if (!(exception instanceof HttpException)) {
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'INTERNAL_ERROR',
        message: DEFAULT_MESSAGES.INTERNAL_ERROR,
      };
    }

    const statusCode = exception.getStatus();
    const payload = exception.getResponse();
    // tylko 400 — inaczej wyjątek biznesowy, który przypadkiem niesie `fields` (np. 409
    // z listą kolidujących terminów), dostałby kod VALIDATION_FAILED i zgubił swój komunikat
    const fields =
      statusCode === HttpStatus.BAD_REQUEST ? this.readFields(payload) : null;
    if (fields) {
      return {
        statusCode,
        code: 'VALIDATION_FAILED',
        message: DEFAULT_MESSAGES.VALIDATION_FAILED,
        fields,
      };
    }

    const code = codeForStatus(statusCode);
    return { statusCode, code, message: this.readMessage(payload, code) };
  }

  /** Koperta z `validationExceptionFactory`; inne kształty (w tym `message: string[]`
   *  z domyślnego `ValidationPipe`) świadomie nie dają `fields`. */
  private readFields(payload: unknown): ApiErrorField[] | null {
    if (!isRecord(payload) || !Array.isArray(payload.fields)) {
      return null;
    }
    return payload.fields as ApiErrorField[];
  }

  private readMessage(payload: unknown, code: ApiErrorBody['code']): string {
    const raw = typeof payload === 'string' ? payload : this.readPayloadMessage(payload);
    return raw && !isFrameworkMessage(raw) ? raw : DEFAULT_MESSAGES[code];
  }

  private readPayloadMessage(payload: unknown): string | null {
    if (isRecord(payload) && typeof payload.message === 'string') {
      return payload.message;
    }
    return null;
  }
}
