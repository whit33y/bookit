import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { currentLocale } from '../../core/i18n/locale';
import LanguageSwitcher from './language-switcher';

async function setup(): Promise<ComponentFixture<LanguageSwitcher>> {
  TestBed.configureTestingModule({ imports: [LanguageSwitcher] });
  const fixture = TestBed.createComponent(LanguageSwitcher);
  await fixture.whenStable();
  return fixture;
}

const buttons = (fixture: ComponentFixture<LanguageSwitcher>) =>
  Array.from(
    fixture.nativeElement.querySelectorAll<HTMLButtonElement>('button'),
  );

describe('LanguageSwitcher', () => {
  it('oznacza aktualny język przez aria-pressed', async () => {
    const fixture = await setup();
    const [pl, en] = buttons(fixture);

    expect(pl.getAttribute('aria-pressed')).toBe('true');
    expect(en.getAttribute('aria-pressed')).toBe('false');
  });

  it('każdy przycisk niesie własny atrybut lang', async () => {
    const fixture = await setup();
    expect(buttons(fixture).map((b) => b.getAttribute('lang'))).toEqual([
      'pl',
      'en',
    ]);
  });

  it('grupa ma dwujęzyczną etykietę — czyta ją też ktoś, kto nie rozumie aktualnego języka', async () => {
    const fixture = await setup();
    const group = fixture.nativeElement.querySelector('[role="group"]');
    expect(group.getAttribute('aria-label')).toBe('Język / Language');
  });

  it('klik przełącza język i zapamiętuje wybór', async () => {
    const fixture = await setup();
    buttons(fixture)[1].click();
    await fixture.whenStable();

    expect(currentLocale()).toBe('en');
    expect(localStorage.getItem('bookit.locale')).toBe('en');
    expect(buttons(fixture)[1].getAttribute('aria-pressed')).toBe('true');
  });
});
