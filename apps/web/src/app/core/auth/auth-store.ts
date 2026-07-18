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
}

const ACCESS_KEY = 'bookit.accessToken';
const REFRESH_KEY = 'bookit.refreshToken';

function decodeJwt(token: string): AuthUser | null {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
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

  readonly accessToken = this.accessTokenSignal.asReadonly();
  readonly user = computed<AuthUser | null>(() => {
    const token = this.accessTokenSignal();
    return token ? decodeJwt(token) : null;
  });
  readonly isLoggedIn = computed(() => this.user() !== null);

  private refreshPromise: Promise<void> | null = null;

  setTokens(pair: TokenPair): void {
    localStorage.setItem(ACCESS_KEY, pair.accessToken);
    localStorage.setItem(REFRESH_KEY, pair.refreshToken);
    this.accessTokenSignal.set(pair.accessToken);
    this.refreshTokenSignal.set(pair.refreshToken);
  }

  logout(): void {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    this.accessTokenSignal.set(null);
    this.refreshTokenSignal.set(null);
    this.router.navigate(['/login']);
  }

  /** Single-flight: równoległe 401 współdzielą jeden refresh. */
  refresh(): Promise<void> {
    this.refreshPromise ??= this.doRefresh().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async doRefresh(): Promise<void> {
    const refreshToken = this.refreshTokenSignal();
    if (!refreshToken) {
      throw new Error('Brak refresh tokenu');
    }
    const pair = await firstValueFrom(
      this.api.post<TokenPair>('/auth/refresh', { refreshToken }),
    );
    this.setTokens(pair);
  }
}
