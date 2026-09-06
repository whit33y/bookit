import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import AccountSettings from './account';
import PersonalDetails from './personal-details';
import ProfilePhoto from './profile-photo';

// Sekcje mają własne speki i własne żądania — tutaj badamy sam szkielet strony.
@Component({ selector: 'app-personal-details', template: '' })
class PersonalDetailsStub {}

@Component({ selector: 'app-profile-photo', template: '' })
class ProfilePhotoStub {}

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
        remove: { imports: [PersonalDetails, ProfilePhoto] },
        add: { imports: [PersonalDetailsStub, ProfilePhotoStub] },
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
