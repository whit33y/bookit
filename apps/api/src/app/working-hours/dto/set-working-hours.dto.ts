import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

// pojedynczy przedział pracy w dniu; czas lokalny firmy (Europe/Warsaw)
export class WorkingHoursSlotDto {
  @IsInt()
  @Min(0)
  @Max(6) // 0 = poniedziałek … 6 = niedziela
  weekday!: number;

  // format "HH:mm", 00:00–23:59 (zero-padded → poprawne porównanie stringów)
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime musi mieć format HH:mm' })
  startTime!: string;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'endTime musi mieć format HH:mm' })
  endTime!: string;
}

// cały grafik tygodniowy naraz — PUT zastępuje wszystko.
// Reguły start<end oraz brak nachodzenia sprawdza serwis (walidacja krzyżowa między przedziałami).
export class SetWorkingHoursDto {
  @IsArray()
  @ArrayMaxSize(50) // rozsądny limit: 7 dni × kilka przedziałów
  @ValidateNested({ each: true })
  @Type(() => WorkingHoursSlotDto)
  slots!: WorkingHoursSlotDto[];
}
