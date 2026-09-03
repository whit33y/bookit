import { describe, expect, it } from 'vitest';
import { BusinessApplicationData } from './business-application';
import { renderBusinessApplicationEmail } from './business-application.template';

const APP_URL = 'http://localhost:4200';

const data = (over: Partial<BusinessApplicationData> = {}): BusinessApplicationData => ({
  name: 'Salon Ola',
  rejectionReason: null,
  owner: { firstName: 'Ola' },
  ...over,
});

describe('renderBusinessApplicationEmail', () => {
  // ten sam adres co w powiadomieniu in-app: klik z maila i klik z dzwoneczka mają
  // kończyć się w tym samym miejscu
  it('akceptacja odsyła na to samo zgłoszenie co dzwoneczek', () => {
    const message = renderBusinessApplicationEmail('APPROVED', data(), APP_URL);

    expect(message.subject).toBe('Zgłoszenie firmy zaakceptowane: Salon Ola');
    expect(message.text).toContain(`${APP_URL}/create-business`);
    expect(message.html).toContain(`href="${APP_URL}/create-business"`);
  });

  it('odrzucenie niesie powód i odsyła na formularz zgłoszenia', () => {
    const message = renderBusinessApplicationEmail(
      'REJECTED',
      data({ rejectionReason: 'Adres nie zgadza się z rejestrem' }),
      APP_URL,
    );

    expect(message.subject).toBe('Zgłoszenie firmy odrzucone: Salon Ola');
    expect(message.text).toContain('Powód: Adres nie zgadza się z rejestrem');
    expect(message.html).toContain('Powód: Adres nie zgadza się z rejestrem');
    expect(message.text).toContain(`${APP_URL}/create-business`);
  });

  // rejectionReason jest nullowalne w schemacie, a mail nie może wyjść z „Powód: null"
  it('odrzucenie bez zapisanego powodu nie pokazuje pustego pola', () => {
    const message = renderBusinessApplicationEmail('REJECTED', data(), APP_URL);

    expect(message.text).toContain('Powód: nie podano');
    expect(message.text).not.toContain('null');
  });

  it('nazwa firmy z formularza nie ucieka do HTML-a', () => {
    const message = renderBusinessApplicationEmail(
      'REJECTED',
      data({ name: '<b>Salon</b>', rejectionReason: '<script>alert(1)</script>' }),
      APP_URL,
    );

    expect(message.html).not.toContain('<b>Salon</b>');
    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;b&gt;Salon&lt;/b&gt;');
  });
});
