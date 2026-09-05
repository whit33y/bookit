import {
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { BusinessImageKind, UserRole } from '@prisma/client';
import { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { etagMatches } from '../common/http/etag';
import { AuthUser } from '../common/types/auth-user';
import { IMAGE_SLOTS, MAX_IMAGE_BYTES } from './business-image';
import { BusinessImagesService } from './business-images.service';
import { ParseImageKindPipe } from './parse-image-kind.pipe';

/** Rok — pod danym ETagiem treść już się nie zmieni, a nowa wersja przychodzi do klienta
 *  jako inny cache-buster w query stringu (ADR-0001), więc omija to, co leży w cache. */
const IMMUTABLE_CACHE = 'max-age=31536000, immutable';

/** Każde wgranie to dekodowanie i przeskalowanie do 5 MB przez sharpa — najdroższa rzecz,
 *  jaką właściciel może wywołać jednym żądaniem. Limit hojny wobec poprawiania obrazka
 *  w ustawieniach, ciasny wobec zapętlonego skryptu. */
const UPLOADS_PER_MINUTE = { default: { limit: 10, ttl: 60_000 } };

/**
 * Wizerunek firmy (#153). Osobny kontroler od `BusinessesController`, bo te trasy operują na
 * bajtach, nie na JSON-ie: mają własny interceptor multiparta i własne nagłówki cache'ujące.
 * Ścieżki mają po trzy segmenty, więc nie kolidują z parametrycznym `GET /businesses/:slug`.
 */
@Controller('businesses')
export class BusinessImagesController {
  constructor(private readonly images: BusinessImagesService) {}

  // limit rozmiaru także tutaj, nie tylko w serwisie: multer urywa strumień po przekroczeniu
  // i rzuca LIMIT_FILE_SIZE (→ 413), więc 50-megabajtowe żądanie nie ląduje w pamięci w całości
  @Put('mine/images/:kind')
  @UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
  @Roles(UserRole.OWNER)
  @Throttle(UPLOADS_PER_MINUTE)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }),
  )
  async replace(
    @CurrentUser() user: AuthUser,
    @Param('kind', ParseImageKindPipe) kind: BusinessImageKind,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const { version } = await this.images.replaceMine(user.sub, kind, file);
    return { kind: IMAGE_SLOTS[kind].param, version };
  }

  @Delete('mine/images/:kind')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('kind', ParseImageKindPipe) kind: BusinessImageKind,
  ) {
    return this.images.removeMine(user.sub, kind);
  }

  /**
   * Publiczny odczyt — bez guardów i **bez** warunku „firma działająca". Świadomie: inaczej
   * właściciel firmy czekającej na akceptację albo zablokowanej nie zobaczyłby podglądu we
   * własnych ustawieniach. Obrazek nie zdradza niczego ponad to, co firma sama wystawiła.
   */
  @Get(':id/images/:kind')
  @Header('Cache-Control', IMMUTABLE_CACHE)
  async serve(
    @Param('id') businessId: string,
    @Param('kind', ParseImageKindPipe) kind: BusinessImageKind,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    // wskaźnik z `Business` idzie osobnym, lekkim zapytaniem — przy trafieniu w cache bajty
    // w ogóle nie wychodzą z bazy
    const known = await this.images.findVersion(businessId, kind);
    if (etagMatches(ifNoneMatch, `"${known}"`)) {
      res.setHeader('ETag', `"${known}"`);
      res.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }

    // ETag odpowiedzi z treścią bierze się z wiersza z bajtami, nie z `Business`: równoległe
    // wgranie między tymi zapytaniami inaczej wystawiłoby stare bajty pod nową wersją,
    // a `immutable` utrwaliłoby tę pomyłkę w cache klienta na rok
    const image = await this.images.findBytes(businessId, kind);
    res.setHeader('ETag', `"${image.version}"`);
    return new StreamableFile(Buffer.from(image.bytes), { type: image.mime });
  }
}
