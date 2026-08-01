/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { validationExceptionFactory } from './app/common/errors/validation-exception.factory';
import { ApiExceptionFilter } from './app/common/filters/api-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      // bez tego 400 wraca jako tablica angielskich zdań class-validatora (#45)
      exceptionFactory: validationExceptionFactory,
    }),
  );
  // rejestrowany po pipe, ale łapie wszystko — łącznie z 404 na trasie spoza kontrolerów
  app.useGlobalFilters(new ApiExceptionFilter());
  const port = process.env.PORT || 3000;
  await app.listen(port);
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`,
  );
}

bootstrap();
