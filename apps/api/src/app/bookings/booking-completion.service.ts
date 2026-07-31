import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BookingStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Co 15 minut, zapisem `*/15` zamiast presetu CronExpression — ten nie ma wariantu
// 15-minutowego (najbliższe to EVERY_10_MINUTES i EVERY_30_MINUTES). Pięć pól, nie sześć:
// wariant sześciopolowy liczy sekundy, więc literówka zamieniłaby 96 przebiegów na dobę
// na 5760. Eksportowana, żeby spec mógł pilnować kształtu wyrażenia.
export const COMPLETION_CRON = '*/15 * * * *';

/**
 * Cron domykający zakończone wizyty (#39, SDD §7): co 15 minut potwierdzone rezerwacje,
 * które już się skończyły, przechodzą w `COMPLETED`. Jedyne przejście w tej maszynie stanów,
 * którego nie inicjuje człowiek — decyzje firmy (#26) i odwołania (#27) idą przez
 * `BookingsService.transition()`, ten job zamyka resztę diagramu i daje M9 (recenzje)
 * odpowiedź na pytanie „czy wizyta się odbyła".
 *
 * Job siedzi w bookings, nie w notifications: nie wysyła żadnego maila (COMPLETED nie ma
 * adresata — `BOOKING_EMAIL_RECIPIENT` w booking.template.ts) i dotyka wyłącznie statusu,
 * więc jego domeną są rezerwacje.
 */
@Injectable()
export class BookingCompletionService {
  private readonly logger = new Logger(BookingCompletionService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(COMPLETION_CRON)
  handleCron(): void {
    // @Cron ignoruje zwróconą wartość, więc promisa musi domknąć się tutaj. Błędy bazy
    // obsługuje już completePastBookings; ten catch zostaje na to, czego nie da się
    // zalogować (padnięty transport loggera) — bez niego byłby to unhandledRejection,
    // a przy domyślnym ustawieniu Node'a linijka logu ubiłaby proces API.
    void this.completePastBookings().catch(() => undefined);
  }

  /**
   * Domyka wizyty zakończone przed `now` i zwraca liczbę zmienionych rezerwacji.
   *
   * Jeden `updateMany`, nie pętla po rekordach (AC #39). Poza wymogiem wprost, bulk jest tu
   * jedyną sensowną formą, bo przejście nie ma efektów ubocznych per rezerwacja: nie idzie
   * mail (COMPLETED nie ma adresata), więc nie ma po co ściągać danych pojedynczych wizyt.
   *
   * Idempotencja bierze się z samego warunku: `status: CONFIRMED` przestaje pasować, gdy tylko
   * rekord zostanie przestawiony, więc powtórny przebieg — czy to następny tick, czy druga
   * instancja API, czy ticki nachodzące na siebie — trafia w zbiór pusty. Postgres w READ
   * COMMITTED przelicza WHERE po zwolnieniu blokady wiersza, więc równoległy UPDATE nie
   * przestawi tego samego rekordu dwa razy i nie potrzeba tu advisory locka.
   *
   * `now` argumentem (jak w cancellation-policy.ts) — testy sprawdzają granicę bez fake timerów,
   * a cały przebieg pracuje na jednym znaczniku czasu. Granica jest ostra (`lt`), zgodnie
   * z SDD §7 „`CONFIRMED` z `endsAt < now`"; wizyta kończąca się dokładnie teraz domknie się
   * przy następnym ticku.
   */
  async completePastBookings(now = new Date()): Promise<number> {
    let count: number;
    try {
      // Filtr po CONFIRMED realizuje AC „inne statusy nietknięte": PENDING czeka na decyzję
      // firmy, a stany terminalne (odwołania, odrzucenie) są końcem historii rezerwacji —
      // zaległa wizyta w żadnym z nich nie jest „odbytą wizytą".
      ({ count } = await this.prisma.booking.updateMany({
        where: { status: BookingStatus.CONFIRMED, endsAt: { lt: now } },
        data: { status: BookingStatus.COMPLETED },
      }));
    } catch (e) {
      // Bez rzucania dalej — patrz `void` w handleCron. Nieudany tick nic nie psuje:
      // te same rezerwacje nadal spełniają warunek i domkną się za 15 minut.
      this.logger.error(
        'Nie udało się domknąć zakończonych rezerwacji',
        e instanceof Error ? e.stack : String(e),
      );
      return 0;
    }

    // Bez liczebnika w środku zdania — inaczej log wymagałby odmiany („1 rezerwacji").
    // Puste ticki milczą, bo przy 96 przebiegach na dobę byłby to sam szum.
    if (count > 0) {
      this.logger.log(`Rezerwacje domknięte jako zakończone: ${count}`);
    }
    return count;
  }
}
