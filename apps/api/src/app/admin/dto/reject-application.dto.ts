import { IsString, Matches, MaxLength } from 'class-validator';

/**
 * Body dla POST /admin/business-applications/:id/reject. Powód jest wymagany — bez niego
 * zgłaszający nie wie, co poprawić, a odrzucenie ma zostawiać drogę powrotną (CONTEXT.md).
 * 500 znaków jak `clientNote` w CreateBookingDto: jeden akapit, nie korespondencja.
 */
export class RejectApplicationDto {
  // Warunek na znak niebiały zamiast @IsNotEmpty: samo "   " przechodzi jako niepusty string,
  // a po przycięciu w serwisie zostałby pusty powód — czyli dokładnie to, czego AC zabrania.
  @IsString()
  @Matches(/\S/, { message: 'reason jest wymagany' })
  @MaxLength(500, { message: 'reason może mieć najwyżej 500 znaków' })
  reason!: string;
}
