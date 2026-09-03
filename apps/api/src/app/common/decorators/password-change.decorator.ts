import { SetMetadata } from '@nestjs/common';

export const PASSWORD_CHANGE_ALLOWED_KEY = 'passwordChangeAllowed';

/**
 * Wyjątek od strażnika wymuszonej zmiany hasła (#144): trasa działa również dla konta
 * z `mustChangePassword`. Domyślne jest zamknięcie — nowa trasa nie otwiera się sama,
 * bo ktoś zapomniał o strażniku, tylko dlatego, że ktoś ją świadomie odznaczył.
 */
export const AllowedDuringPasswordChange = () =>
  SetMetadata(PASSWORD_CHANGE_ALLOWED_KEY, true);
