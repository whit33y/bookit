import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

// body dla POST /bookings/:id/review. Bez bookingId (jest w ścieżce), bez clientId i businessId —
// pierwsze bierzemy z tokena, drugie z rezerwacji, więc nie da się podpiąć oceny pod obcą firmę.
export class CreateReviewDto {
  // Zakres pilnuje też CHECK w bazie (migracja #46); tutaj, żeby klient dostał 400 zamiast 500
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  // limit jak clientNote w CreateBookingDto — jeden limit tekstowy w całym API
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
