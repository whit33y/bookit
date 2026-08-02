import { describe, expect, it } from 'vitest';
import { pluralPl } from './plural-pl';

const opinions = (count: number) => pluralPl(count, 'opinia', 'opinie', 'opinii');

describe('pluralPl', () => {
  it.each([
    [1, 'opinia'],
    [2, 'opinie'],
    [4, 'opinie'],
    [5, 'opinii'],
    [22, 'opinie'],
    [25, 'opinii'],
    [101, 'opinii'], // „101 opinii" — 1 na końcu nie wraca do formy pojedynczej
  ])('%i → %s', (count, expected) => {
    expect(opinions(count)).toBe(expected);
  });

  // nastki są jedynym miejscem, gdzie sama ostatnia cyfra prowadzi na manowce
  it.each([12, 13, 14, 112])('nastka %i bierze formę mnogą, nie „opinie"', (count) => {
    expect(opinions(count)).toBe('opinii');
  });

  it('zero bierze formę mnogą', () => {
    expect(opinions(0)).toBe('opinii');
  });
});
