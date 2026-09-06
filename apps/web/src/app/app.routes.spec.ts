import { appRoutes } from './app.routes';
import { authGuard, passwordChangeGuard } from './core/auth/auth.guard';

/**
 * Wiring, nie logika: sam guard ma testy w `auth.guard.spec.ts`, a tu pilnujemy, że nowa trasa
 * najwyższego poziomu nie wymknie się spod wymuszonej zmiany hasła (#146).
 */
describe('appRoutes', () => {
  it('każda trasa najwyższego poziomu zaczyna od passwordChangeGuard', () => {
    // pierwszy, nie gdziekolwiek: konto spod flagi ma trafić na zmianę hasła,
    // a nie na /login z guarda roli
    const missing = appRoutes
      .filter((route) => route.canActivate?.[0] !== passwordChangeGuard)
      .map((route) => route.path);
    expect(missing).toEqual([]);
  });

  it('ustawienia konta stoją za authGuard, bez zawężania do roli (#162)', () => {
    const account = appRoutes.find((route) => route.path === 'account');

    expect(account?.canActivate).toEqual([passwordChangeGuard, authGuard]);
  });

  it('ma trasę ekranu zmiany hasła', () => {
    expect(appRoutes.map((route) => route.path)).toContain('change-password');
  });
});
