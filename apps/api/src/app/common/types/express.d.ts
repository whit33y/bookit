import { AuthUser } from './auth-user';

// JwtAuthGuard dokleja zweryfikowanego usera do requestu
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
