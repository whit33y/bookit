import { UserRole } from '@prisma/client';

// payload access tokenu (patrz AuthService.issueTokens) — to trafia do req.user
export interface AuthUser {
  sub: string;
  email: string;
  role: UserRole;
}
