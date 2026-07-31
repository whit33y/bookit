import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BookingStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import { REMINDER_TICK_MIN, reminderWindow } from './reminder-window';

// Harmonogram liczony z REMINDER_TICK_MIN, a nie z presetu CronExpression (ten nie ma wariantu
// 15-minutowego): krok crona i szerokość okna muszą pozostać tą samą liczbą.
//
// Zapis `*/N` dzieli godzinę od nowa, więc równość kroku i okna trzyma się tylko dla dzielników
// 60. Dla 25 minut cron odpaliłby o :00, :25 i :50, czyli ostatni odstęp w godzinie miałby
// 10 minut przy 25-minutowych oknach — stąd asercja poniżej, a nie sam komentarz.
const REMINDER_CRON = `*/${REMINDER_TICK_MIN} * * * *`;

if (60 % REMINDER_TICK_MIN !== 0) {
  throw new Error(
    `REMINDER_TICK_MIN musi być dzielnikiem 60, żeby harmonogram "${REMINDER_CRON}" ` +
      'pokrywał oś czasu równymi krokami',
  );
}

/**
 * Cron przypomnień o wizycie (#38, SDD §7): co 15 minut potwierdzone rezerwacje ze `startsAt`
 * w oknie z reminder-window.ts dostają maila, o ile jeszcze go nie dostały. Rezerwacja
 * potwierdzona na czas trafia w swój tick ~24 h przed wizytą; potwierdzona później zostaje
 * nadgoniona przy najbliższym.
 *
 * Job siedzi w notifications, bo przypomnienie to powiadomienie — nie dotyka maszyny stanów
 * ani statusu rezerwacji. Cron auto-`COMPLETED` (#39) trafi do bookings, gdzie jest jego domena.
 */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(REMINDER_CRON)
  handleCron(): void {
    // sendDueReminders nigdy nie odrzuca, więc `void` jest tu bezpieczne — @Cron nie ma komu
    // oddać odrzuconej promisy i błąd wyleciałby jako unhandledRejection.
    void this.sendDueReminders();
  }

  /**
   * Wysyła przypomnienia należne na moment `now` i zwraca ich liczbę.
   *
   * `now` argumentem (jak w cancellation-policy.ts) — testy sprawdzają okno i „dokładnie raz"
   * bez fake timerów, a cały przebieg pracuje na jednym znaczniku czasu.
   */
  async sendDueReminders(now = new Date()): Promise<number> {
    const { from, to } = reminderWindow(now);

    let due: { id: string }[];
    try {
      due = await this.prisma.booking.findMany({
        // Filtr po CONFIRMED realizuje AC „rezerwacja odwołana przed oknem nie dostaje
        // przypomnienia": odwołanie zmienia status, więc rekord tu nie wchodzi.
        where: {
          status: BookingStatus.CONFIRMED,
          reminderSentAt: null,
          startsAt: { gte: from, lt: to },
        },
        // Sam identyfikator — komplet danych do maila dobiera NotificationsService, tak jak
        // przy zdarzeniach z BookingEventsService.
        select: { id: true },
      });
    } catch (e) {
      this.logger.error(
        'Nie udało się odczytać rezerwacji do przypomnienia',
        e instanceof Error ? e.stack : String(e),
      );
      return 0;
    }

    let sent = 0;
    // Szeregowo, nie Promise.all: wolumen jednego ticku jest mały, a równoległa wysyłka
    // otwierałaby tyle połączeń SMTP, ile rezerwacji.
    for (const { id } of due) {
      // try wokół pojedynczej rezerwacji, nie wokół pętli: sendReminder woła bazę, a ta potrafi
      // odrzucić (deadlock, timeout połączenia). Awaria jednej rezerwacji nie może zabrać
      // przypomnień pozostałym z tego okna — okno mija i nikt do niego nie wróci.
      try {
        if (await this.sendReminder(id, now)) {
          sent += 1;
        }
      } catch (e) {
        this.logger.error(
          `Nie udało się obsłużyć przypomnienia dla rezerwacji ${id}`,
          e instanceof Error ? e.stack : String(e),
        );
      }
    }

    // Bez liczebnika w środku zdania — inaczej log wymagałby odmiany („1 przypomnień").
    // Puste ticki milczą, bo przy 96 przebiegach na dobę byłby to sam szum.
    if (sent > 0) {
      this.logger.log(`Przypomnienia o wizycie wysłane: ${sent}`);
    }
    return sent;
  }

  /**
   * Jedno przypomnienie w schemacie „najpierw zajmij, potem wyślij".
   *
   * Warunek `reminderSentAt: null` w UPDATE jest rozstrzygany atomowo przez bazę, więc dwie
   * instancje API (albo nakładające się ticki) nie wyślą duplikatu — przegrany dostaje
   * `count: 0` i nic nie robi. Odwrotna kolejność (wyślij, potem zaznacz) daje przy awarii
   * między jednym a drugim maila bez znacznika, czyli przypomnienie wysłane dwa razy.
   *
   * `status` jest powtórzony z zapytania wyżej, bo między SELECT-em a tym UPDATE-em mija cała
   * wysyłka poprzednich rezerwacji z paczki (SMTP, szeregowo). Klient może w tym czasie odwołać
   * wizytę — polityka jeszcze na to pozwala, deadline mija dopiero teraz — a bez tego warunku
   * dostałby maila „przypominamy o jutrzejszej wizycie" do odwołanej rezerwacji (AC #38).
   */
  private async sendReminder(bookingId: string, now: Date): Promise<boolean> {
    const claimed = await this.prisma.booking.updateMany({
      where: {
        id: bookingId,
        status: BookingStatus.CONFIRMED,
        reminderSentAt: null,
      },
      data: { reminderSentAt: now },
    });
    if (claimed.count === 0) {
      return false;
    }

    if (await this.notifications.bookingReminder(bookingId)) {
      return true;
    }

    // Wysyłka padła (NotificationsService zalogował powód) — znacznik wraca, żeby nie zostawić
    // rezerwacji oznaczonej jako przypomnianej bez maila. Warunek na `now` zawęża cofnięcie do
    // znacznika postawionego w tym przebiegu, żeby nie wyczyścić cudzego.
    await this.prisma.booking.updateMany({
      where: { id: bookingId, reminderSentAt: now },
      data: { reminderSentAt: null },
    });
    this.logger.error(`Przypomnienie dla rezerwacji ${bookingId} nie zostało wysłane`);
    return false;
  }
}
