import { IsISO8601, IsOptional, IsString, MaxLength, IsUUID } from 'class-validator';

// body dla POST /bookings. Brak businessId i endsAt — jedno wynika z usługi, drugie
// z jej durationMin, więc klient nie może ich podrobić. clientId bierzemy z tokena.
export class CreateBookingDto {
  @IsUUID('all')
  serviceId!: string;

  @IsUUID('all')
  employeeId!: string;

  // instant startu wizyty; siatkę 15 min i przyszłość sprawdza serwis
  @IsISO8601()
  startsAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  clientNote?: string;
}
