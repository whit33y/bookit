import {
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Res,
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
import { MAX_IMAGE_BYTES } from '../common/images/image-upload';
import {
  ImmutableImage,
  UPLOADS_PER_MINUTE,
  serveImage,
} from '../common/images/serve-image';
import { AuthUser } from '../common/types/auth-user';
import { IMAGE_SLOTS } from './business-image';
import { BusinessImagesService } from './business-images.service';
import { ParseImageKindPipe } from './parse-image-kind.pipe';

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
  @ImmutableImage()
  serve(
    @Param('id') businessId: string,
    @Param('kind', ParseImageKindPipe) kind: BusinessImageKind,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return serveImage(res, ifNoneMatch, {
      findVersion: () => this.images.findVersion(businessId, kind),
      findBytes: () => this.images.findBytes(businessId, kind),
    });
  }
}
