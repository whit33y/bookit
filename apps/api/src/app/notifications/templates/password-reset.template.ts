import { RenderedEmail, escapeHtml } from './email';

// Treść przeniesiona z AuthService (#4) — moduł notifications wchłania wysyłkę, auth
// zostaje przy tokenie. Link i TTL bez zmian: token ważny godzinę (RESET_TOKEN_TTL_MS).
export const renderPasswordResetEmail = (
  firstName: string,
  token: string,
  appUrl: string,
): RenderedEmail => {
  // token jest hexem z randomBytes, więc nie wymaga encodeURIComponent — ale niech
  // szablon nie zakłada kształtu wejścia
  const link = `${appUrl}/reset-password?token=${encodeURIComponent(token)}`;

  return {
    subject: 'Reset hasła w BookIt',
    text:
      `Cześć ${firstName},\n\n` +
      `Aby ustawić nowe hasło, otwórz poniższy link (ważny przez godzinę):\n` +
      `${link}\n\n` +
      `Jeśli to nie Ty prosiłeś o reset hasła, zignoruj tę wiadomość.`,
    html:
      '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2933;">' +
      '<h2 style="font-size:18px;margin:0 0 12px;">Reset hasła</h2>' +
      `<p style="margin:0 0 16px;">Cześć ${escapeHtml(firstName)},</p>` +
      '<p style="margin:0 0 16px;">Aby ustawić nowe hasło, otwórz poniższy link ' +
      '(ważny przez godzinę):</p>' +
      `<p style="margin:0 0 16px;"><a href="${escapeHtml(link)}">Ustaw nowe hasło</a></p>` +
      '<p style="margin:0 0 16px;color:#616e7c;">Jeśli to nie Ty prosiłeś o reset hasła, ' +
      'zignoruj tę wiadomość.</p>' +
      '<p style="margin:0;color:#616e7c;">— BookIt</p>' +
      '</div>',
  };
};
