import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { normalizeEmail } from '../common/credentials';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChangeEmailDto } from './dto/change-email.dto';
import { UpdateMeDto } from './dto/update-me.dto';

// jawny select bez passwordHash — profil nigdy nie wycieka hasła
const profileSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  role: true,
  isBlocked: true,
  // #144: front pyta o profil również spod flagi (to jedna z dwóch dozwolonych tras),
  // więc stąd dowiaduje się, że zamiast panelu ma pokazać formularz zmiany hasła
  mustChangePassword: true,
  // #163: sam wskaźnik na zdjęcie profilowe — front składa z niego adres obrazu albo pokazuje
  // monogram, gdy `null`. Bajty nigdy nie idą tą trasą, leżą w `UserImage`.
  avatarVersion: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ważny token dla usera usuniętego w międzyczasie → 404 zamiast 200 null
  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: profileSelect,
    });
    if (!user) throw new NotFoundException('Nie znaleziono użytkownika');
    return user;
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: dto,
        select: profileSelect,
      });
    } catch (e) {
      // usunięty user (ważny token) → 404 zamiast 500 z P2025
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2025'
      ) {
        throw new NotFoundException('Nie znaleziono użytkownika');
      }
      throw e;
    }
  }

  /**
   * Zmiana adresu e-mail konta (#167). Wchodzi natychmiast, bez linku potwierdzającego na nowy
   * adres — świadomy wybór opisany w ADR-0003, tam też cztery rzeczy, które kompensują ryzyko
   * literówki: hasło, powtórzony adres, wylogowanie i ta wiadomość na stary adres.
   *
   * Odpowiedzią jest profil, nigdy nowa para tokenów: użytkownik zostaje wylogowany i musi
   * zalogować się nowym adresem. To zarazem nieformalna weryfikacja — żeby wrócić, trzeba ten
   * adres zobaczyć i wpisać.
   */
  async changeEmail(userId: string, dto: ChangeEmailDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Nie znaleziono użytkownika');

    // 400, nie 401, jak przy change-password: 401 wywala frontowy interceptor na wylogowanie,
    // a literówka w haśle ma zostać literówką w formularzu
    if (!(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new BadRequestException('Nieprawidłowe hasło');
    }

    // Normalizacja tą samą funkcją co przy rejestracji — inaczej „Jan@example.com" wpisany tutaj
    // rozminąłby się z „jan@example.com" przy logowaniu. Powtórzenie porównujemy już po niej:
    // różnica wielkości liter nie jest literówką, bo obie postaci dają ten sam login.
    const newEmail = normalizeEmail(dto.newEmail);
    if (newEmail !== normalizeEmail(dto.newEmailConfirm)) {
      throw new BadRequestException('Adresy e-mail nie są takie same');
    }
    if (newEmail === user.email) {
      throw new BadRequestException('Nowy adres e-mail musi różnić się od obecnego');
    }

    const updated = await this.writeEmail(user.id, newEmail);

    // Po commicie i bez `void`: metoda nie odrzuca (kontrakt NotificationsService), więc
    // czekanie na nią nie może wywrócić zapisanej już zmiany, a wołający wie, że wiadomość
    // wyszła przed odpowiedzią.
    await this.notifications.emailChanged(user.email, user.firstName, newEmail);
    return updated;
  }

  /** Sam zapis: nowy adres i koniec wszystkich sesji w jednej transakcji. */
  private async writeEmail(userId: string, email: string) {
    try {
      const [updated] = await this.prisma.$transaction([
        this.prisma.user.update({
          where: { id: userId },
          data: { email },
          select: profileSelect,
        }),
        // Zmiana loginu kasuje **wszystkie** refresh tokeny, także ten wołającego: gdyby
        // przetrwały, przejęte konto dałoby się dalej odświeżać starym adresem.
        this.prisma.refreshToken.deleteMany({ where: { userId } }),
      ]);
      return updated;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        // 409, mimo że ujawnia zajętość adresu — rejestracja i tak ją zdradza, a ciche
        // „zmieniono", po którym nie da się zalogować, byłoby gorsze
        if (e.code === 'P2002') {
          throw new ConflictException('Konto z tym adresem e-mail już istnieje');
        }
        // usunięty user (ważny token) → 404 zamiast 500 z P2025
        if (e.code === 'P2025') {
          throw new NotFoundException('Nie znaleziono użytkownika');
        }
      }
      throw e;
    }
  }
}
