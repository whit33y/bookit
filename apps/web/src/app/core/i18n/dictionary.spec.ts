import { describe, expect, it } from 'vitest';
import { en } from './en';
import { pl } from './pl';

/**
 * Typ `Dictionary` wymusza komplet kluczy już na etapie kompilacji, więc te testy są drugą
 * linią obrony: łapią obejście typu (`as any`, `@ts-expect-error`), pusty string podstawiony
 * „na chwilę" i placeholder, który przy tłumaczeniu zgubił nawiasy.
 */
describe('słowniki pl/en', () => {
  it('mają dokładnie ten sam zbiór kluczy', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(pl).sort());
  });

  it('nie mają pustych wartości', () => {
    const empty = [...Object.entries(pl), ...Object.entries(en)]
      .filter(([, value]) => value.trim() === '')
      .map(([key]) => key);
    expect(empty).toEqual([]);
  });

  it('używają tych samych placeholderów po obu stronach', () => {
    const placeholders = (text: string) =>
      [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

    const mismatched = Object.keys(pl).filter((key) => {
      const k = key as keyof typeof pl;
      return (
        placeholders(pl[k]).join(',') !== placeholders(en[k]).join(',')
      );
    });
    expect(mismatched).toEqual([]);
  });

  it('mają komplet form liczby mnogiej wszędzie tam, gdzie jest wariant .other', () => {
    const bases = Object.keys(pl)
      .filter((key) => key.endsWith('.other'))
      .map((key) => key.slice(0, -'.other'.length));

    // polski potrzebuje one/few/many, angielski tylko one/other — ale typ wymaga kompletu,
    // więc oba słowniki muszą mieć wszystkie cztery klucze
    const missing = bases.flatMap((base) =>
      ['one', 'few', 'many'].flatMap((form) =>
        `${base}.${form}` in pl ? [] : [`${base}.${form}`],
      ),
    );
    expect(missing).toEqual([]);
  });
});
