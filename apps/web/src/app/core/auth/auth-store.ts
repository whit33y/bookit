import { Service, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../api-client';

// lustrzane typy backendu (UserRole z prisma, TokenPair z AuthService) — bez importu z api
export type UserRole = 'CLIENT' | 'OWNER' | 'EMPLOYEE' | 'ADMIN';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** Payload access tokenu — patrz AuthService.issueTokens w apps/api. */
export interface AuthUser {
  sub: string;
  email: string;
  role: UserRole;
  /** Wymuszona zmiana hasła (#144) — flaga jedzie w tokenie, więc front zna ją bez
   *  dodatkowego żądania. Opcjonalna, bo tokeny wydane przed #144 tego pola nie mają. */
  mustChangePassword?: boolean;
  /** Standardowe pole JWT — unix timestamp wygaśnięcia (sekundy). */
  exp?: number;
}

/** Ekran wymuszonej zmiany hasła (#146) — cel przekierowań z guarda i z interceptora. */
export const CHANGE_PASSWORD_PATH = '/change-password';

/** Strona domowa dla roli — jedno miejsce, z którego czytają wszystkie ścieżki wyboru celu
 *  (redirect po zalogowaniu, guestGuard, skrót w menu konta).
 *
 *  Klient ląduje na wyszukiwarce firm (`/`), a nie na „Moich wizytach" (#160): świeżo
 *  zalogowany zwykle nie ma jeszcze żadnej wizyty, a przychodzi po to, żeby znaleźć firmę.
 *  Dla pozostałych ról ich panel jest właściwym startem, więc zostaje bez zmian. */
export function homeFor(role: UserRole): string {
  switch (role) {
    case 'ADMIN':
      return '/admin';
    case 'OWNER':
    case 'EMPLOYEE':
      return '/business';
    default:
      return '/';
  }
}

/** Sanityzacja celu powrotu po zalogowaniu (?returnUrl=). Przepuszczamy wyłącznie ścieżki
 *  wewnątrz aplikacji — „//evil.com" i „/\evil.com" przeglądarka potraktowałaby jako adres
 *  absolutny (protocol-relative), więc byłby to open redirect. */
export function safeReturnUrl(url: string | null | undefined): string | null {
  if (!url || !url.startsWith('/') || url.startsWith('//') || url.startsWith('/\\')) {
    return null;
  }
  return url;
}

const ACCESS_KEY = 'bookit.accessToken';
const REFRESH_KEY = 'bookit.refreshToken';

function decodeJwt(token: string): AuthUser | null {
  try {
    const payload: unknown = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
    );
    // guard kształtu: JSON.parse('123') to też poprawny JSON, ale nie user
    return typeof (payload as AuthUser)?.role === 'string'
      ? (payload as AuthUser)
      : null;
  } catch {
    return null;
  }
}

@Service()
export class AuthStore {
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);

  // tokeny w localStorage → sesja przeżywa odświeżenie strony
  private readonly accessTokenSignal = signal<string | null>(
    localStorage.getItem(ACCESS_KEY),
  );
  private readonly refreshTokenSignal = signal<string | null>(
    localStorage.getItem(REFRESH_KEY),
  );

  /** Flaga zapalona przez odpowiedź 403 „musisz zmienić hasło" (#146), a nie przez token.
   *  Potrzebna, bo konto może dostać flagę w bazie już po wydaniu tokenu — wtedy token
   *  jej nie niesie, a mimo to każde żądanie wraca z 403. */
  private readonly forcedPasswordChange = signal(false);

  readonly accessToken = this.accessTokenSignal.asReadonly();
  readonly user = computed<AuthUser | null>(() => {
    const token = this.accessTokenSignal();
    return token ? decodeJwt(token) : null;
  });
  readonly isLoggedIn = computed(() => this.user() !== null);
  /** Czy konto jest zamknięte w ekranie zmiany hasła: albo mówi to token, albo powiedziało
   *  to 403 z dowolnego żądania. */
  readonly mustChangePassword = computed(
    () => this.user()?.mustChangePassword === true || this.forcedPasswordChange(),
  );

  private refreshPromise: Promise<void> | null = null;

  /** Po sukcesie przekierowuje na returnUrl (jeśli podany i bezpieczny), inaczej
   *  na stronę domową roli (symetria z logout → /login). */
  async login(
    dto: { email: string; password: string },
    returnUrl?: string | null,
  ): Promise<void> {
    const pair = await firstValueFrom(
      this.api.post<TokenPair>('/auth/login', dto),
    );
    this.setTokens(pair);
    await this.goHome(returnUrl);
  }

  /** Backend zwraca od razu TokenPair → rejestracja = auto-login + redirect. */
  async register(
    dto: {
      email: string;
      password: string;
      firstName: string;
      lastName: string;
    },
    returnUrl?: string | null,
  ): Promise<void> {
    const pair = await firstValueFrom(
      this.api.post<TokenPair>('/auth/register', dto),
    );
    this.setTokens(pair);
    await this.goHome(returnUrl);
  }

  private async goHome(returnUrl?: string | null): Promise<void> {
    const target = safeReturnUrl(returnUrl);
    if (target) {
      await this.router.navigateByUrl(target);
      return;
    }
    const role = this.user()?.role;
    await this.router.navigateByUrl(role ? homeFor(role) : '/');
  }

  setTokens(pair: TokenPair): void {
    localStorage.setItem(ACCESS_KEY, pair.accessToken);
    localStorage.setItem(REFRESH_KEY, pair.refreshToken);
    this.accessTokenSignal.set(pair.accessToken);
    this.refreshTokenSignal.set(pair.refreshToken);
  }

  logout(): void {
    this.clearTokens();
    this.router.navigate(['/login']);
  }

  /** Sesja padła w tle (refresh odrzucony), a nie na życzenie użytkownika — zapamiętujemy
   *  bieżący adres, żeby po ponownym zalogowaniu wrócił tam, gdzie przerwał (np. do
   *  wypełnionego wizarda rezerwacji), zamiast lądować na stronie domowej roli. */
  private expireSession(): void {
    const returnUrl = safeReturnUrl(this.router.url);
    this.clearTokens();
    this.router.navigate(['/login'], {
      queryParams: returnUrl ? { returnUrl } : {},
    });
  }

  /** Konto z niezmienionym hasłem startowym dostaje 403 na wszystkim poza własnym profilem
   *  i zmianą hasła — wołane z interceptora, żeby użytkownik zobaczył formularz zamiast
   *  komunikatu „brak uprawnień" przy każdej akcji. Nawigacja jest tutaj, a nie w guardzie,
   *  bo 403 przychodzi zwykle bez żadnej nawigacji (żądanie z otwartego już ekranu), więc
   *  guard nie miałby się kiedy uruchomić. */
  requirePasswordChange(): void {
    this.forcedPasswordChange.set(true);
    void this.router.navigateByUrl(CHANGE_PASSWORD_PATH);
  }

  /**
   * Zmiana hasła przez zalogowanego (#146). Backend oddaje nową parę tokenów, bo flaga
   * jedzie w access tokenie — bez wymiany użytkownik zostałby zablokowany własnym, wciąż
   * ważnym tokenem. Po zmianie ląduje na stronie domowej swojej roli (dla ADMIN‑a `/admin`).
   */
  async changePassword(dto: {
    currentPassword: string;
    newPassword: string;
  }): Promise<void> {
    const pair = await firstValueFrom(
      this.api.post<TokenPair>('/auth/change-password', dto),
    );
    this.setTokens(pair);
    this.forcedPasswordChange.set(false);
    await this.goHome();
  }

  private clearTokens(): void {
    this.forcedPasswordChange.set(false);
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    this.accessTokenSignal.set(null);
    this.refreshTokenSignal.set(null);
  }

  /** Single-flight: równoległe 401 współdzielą jeden refresh. */
  refresh(): Promise<void> {
    this.refreshPromise ??= this.doRefresh().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async doRefresh(): Promise<void> {
    try {
      const refreshToken = this.refreshTokenSignal();
      if (!refreshToken) {
        throw new Error('Brak refresh tokenu');
      }
      const pair = await firstValueFrom(
        this.api.post<TokenPair>('/auth/refresh', { refreshToken }),
      );
      this.setTokens(pair);
    } catch (err) {
      // sesja nie do uratowania — wylogowanie raz, niezależnie od liczby czekających 401
      this.expireSession();
      throw err;
    }
  }
}
