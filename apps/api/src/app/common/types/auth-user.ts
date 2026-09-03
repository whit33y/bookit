import { UserRole } from '@prisma/client';

// payload access tokenu (patrz AuthService.issueTokens) — to trafia do req.user
export interface AuthUser {
  sub: string;
  email: string;
  role: UserRole;
  /** Wymuszona zmiana hasła (#144). Jak `role`, jedzie w tokenie zamiast w zapytaniu do bazy
   *  przy każdym żądaniu: flaga zapala się przy zakładaniu konta, więc pierwszy token
   *  tego konta już ją niesie, a gaśnie razem z wydaniem nowej pary tokenów. Opcjonalne,
   *  bo tokeny wydane przed #144 tego pola nie mają. */
  mustChangePassword?: boolean;
}
