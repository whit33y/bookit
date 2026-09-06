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
import { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { MAX_IMAGE_BYTES } from '../common/images/image-upload';
import {
  ImmutableImage,
  UPLOADS_PER_MINUTE,
  serveImage,
} from '../common/images/serve-image';
import { AuthUser } from '../common/types/auth-user';
import { UserAvatarService } from './user-avatar.service';

/**
 * Zdjęcie profilowe (#163). Osobny kontroler od `UsersController`, bo te trasy operują na
 * bajtach, nie na JSON-ie: mają własny interceptor multiparta i własne nagłówki cache'ujące,
 * a publiczny odczyt musi stać poza stosem guardów zamkniętym na całej klasie tamtego.
 *
 * Segment `avatar` bierze się wprost ze specyfikacji trasy (#163) — glosariusz każe mówić
 * w prozie „zdjęcie profilowe", ale URL zostaje angielski jak reszta API.
 */
@Controller('users')
export class UserAvatarController {
  constructor(private readonly avatars: UserAvatarService) {}

  // limit rozmiaru także tutaj, nie tylko w serwisie: multer urywa strumień po przekroczeniu
  // i rzuca LIMIT_FILE_SIZE (→ 413), więc 50-megabajtowe żądanie nie ląduje w pamięci w całości
  @Put('me/avatar')
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Throttle(UPLOADS_PER_MINUTE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }))
  replace(@CurrentUser() user: AuthUser, @UploadedFile() file?: Express.Multer.File) {
    return this.avatars.replaceMine(user.sub, file);
  }

  @Delete('me/avatar')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser) {
    return this.avatars.removeMine(user.sub);
  }

  /**
   * Publiczny odczyt — bez guardów, świadomie: zdjęcie wisi przy publicznych recenzjach razem
   * z imieniem autora, a `id` to uuid. Ukrywanie samego adresu nic by nie chroniło, a zepsułoby
   * cache'owanie, na którym stoi cały wzorzec obrazów (ADR-0001).
   */
  @Get(':id/avatar')
  @ImmutableImage()
  serve(
    @Param('id') userId: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return serveImage(res, ifNoneMatch, {
      findVersion: () => this.avatars.findVersion(userId),
      findBytes: () => this.avatars.findBytes(userId),
    });
  }
}
