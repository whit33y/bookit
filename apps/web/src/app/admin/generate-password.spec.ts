import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../public/form-field/form-field';
import {
  GENERATED_PASSWORD_LENGTH,
  generatePassword,
} from './generate-password';

describe('generatePassword', () => {
  it('mieści się w limitach hasła z backendu', () => {
    const password = generatePassword();
    expect(password.length).toBe(GENERATED_PASSWORD_LENGTH);
    expect(password.length).toBeGreaterThanOrEqual(PASSWORD_MIN_LENGTH);
    expect(password.length).toBeLessThanOrEqual(PASSWORD_MAX_LENGTH);
  });

  it('nie zawiera znaków mylących się przy przepisywaniu', () => {
    expect(generatePassword()).not.toMatch(/[0O1lI]/);
  });

  it('daje za każdym razem inne hasło', () => {
    const passwords = new Set(
      Array.from({ length: 20 }, () => generatePassword()),
    );
    expect(passwords.size).toBe(20);
  });
});
