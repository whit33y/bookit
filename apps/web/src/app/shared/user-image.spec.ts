import { describe, expect, it } from 'vitest';
import { profilePhotoUrl } from './user-image';

describe('adres zdjęcia profilowego', () => {
  it('składa adres publicznej trasy z wersją jako cache-busterem', () => {
    expect(profilePhotoUrl({ id: 'u1', avatarVersion: 'abc123' })).toBe(
      '/api/users/u1/avatar?v=abc123',
    );
  });

  // null z API znaczy „konto nie ma zdjęcia" — wywołujący ma wtedy narysować monogram,
  // a nie odpytywać serwer o coś, czego nie ma
  it('zwraca null, gdy konto nie ma zdjęcia', () => {
    expect(profilePhotoUrl({ id: 'u1', avatarVersion: null })).toBeNull();
  });

  it('escapuje wersję w query stringu', () => {
    expect(profilePhotoUrl({ id: 'u1', avatarVersion: 'v 1' })).toBe(
      '/api/users/u1/avatar?v=v%201',
    );
  });
});
