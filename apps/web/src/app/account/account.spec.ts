import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import type { UserRole } from '../core/auth/auth-store';
import { signInAs } from '../core/auth/auth-testing';
import AccountSettings from './account';
import EmailAddress from './email-address';
import PersonalDetails from './personal-details';
import ProfilePhoto from './profile-photo';

// Sekcje mają własne speki i własne żądania — tutaj badamy sam szkielet strony.
@Component({ selector: 'app-personal-details', template: '' })
class PersonalDetailsStub {}

@Component({ selector: 'app-profile-photo', template: '' })
class ProfilePhotoStub {}

@Component({ selector: 'app-email-address', template: '' })
class EmailAddressStub {}

describe('AccountSettings', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [AccountSettings],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    })
      .overrideComponent(AccountSettings, {
        remove: { imports: [PersonalDetails, ProfilePhoto, EmailAddress] },
        add: {
          imports: [PersonalDetailsStub, ProfilePhotoStub, EmailAddressStub],
        },
      })
      .compileComponents();
  });

  function setup() {
    const fixture = TestBed.createComponent(AccountSettings);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('składa się z sekcji danych osobowych, zdjęcia profilowego i hasła', () => {
    const el = setup();

    expect(el.querySelector('h1')?.textContent).toContain('Ustawienia konta');
    expect(el.querySelector('app-personal-details')).not.toBeNull();
    expect(el.querySelector('app-profile-photo')).not.toBeNull();
    expect(el.textContent).toContain('Hasło');
  });

  it('klient i właściciel dostają sekcję adresu e-mail', () => {
    for (const role of ['CLIENT', 'OWNER'] satisfies UserRole[]) {
      signInAs({ role });
      expect(setup().querySelector('app-email-address')).not.toBeNull();
    }
  });

  it('pracownik i administrator nie dostają sekcji adresu e-mail', () => {
    for (const role of ['EMPLOYEE', 'ADMIN'] satisfies UserRole[]) {
      signInAs({ role });
      expect(setup().querySelector('app-email-address')).toBeNull();
    }
  });

  it('sekcja „Hasło" prowadzi na istniejący ekran zmiany hasła', () => {
    const el = setup();

    const link = el.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/change-password');
    expect(link?.textContent).toContain('Zmień hasło');
  });

  it('nie stawia drugiego formularza hasła — sekcja ma tylko odnośnik', () => {
    const el = setup();

    expect(el.querySelector('input[type="password"]')).toBeNull();
  });

  it('nie wysyła własnych żądań — dane pobiera sekcja', () => {
    setup();

    TestBed.inject(HttpTestingController).verify();
  });
});
