import { describe, expect, it } from 'vitest';
import { renderEmailChangedEmail } from './email-changed.template';

const APP_URL = 'http://localhost:4200';

describe('renderEmailChangedEmail (#167)', () => {
  it('mówi wprost, co się stało, i pokazuje nowy adres', () => {
    const message = renderEmailChangedEmail('Jan', 'nowy@example.com', APP_URL);

    expect(message.subject).toBe('Adres e-mail Twojego konta został zmieniony');
    // nowy adres w treści: jeśli to odbiorca się pomylił, tu zobaczy własną literówkę
    expect(message.text).toContain('nowy@example.com');
    expect(message.html).toContain('nowy@example.com');
    expect(message.text).toContain(`${APP_URL}/login`);
    expect(message.html).toContain(`href="${APP_URL}/login"`);
  });

  // To jedyna ochrona przy przejętym koncie — wiadomość bez ostrzeżenia byłaby zwykłym
  // potwierdzeniem i nie skłoniłaby nikogo do reakcji.
  it('ostrzega odbiorcę, który zmiany nie zlecał', () => {
    const message = renderEmailChangedEmail('Jan', 'nowy@example.com', APP_URL);

    expect(message.text).toContain('Jeśli tej zmiany nie zleciłeś');
    expect(message.html).toContain('Jeśli tej zmiany nie zleciłeś');
  });

  it('escapuje imię w HTML-u, bo idzie z formularza', () => {
    const message = renderEmailChangedEmail('<b>Jan</b>', 'nowy@example.com', APP_URL);

    expect(message.html).not.toContain('<b>Jan</b>');
    expect(message.html).toContain('&lt;b&gt;Jan&lt;/b&gt;');
  });
});
