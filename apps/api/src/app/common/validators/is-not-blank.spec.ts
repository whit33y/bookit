import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { IsNotBlank, isNotBlank } from './is-not-blank';

class Sample {
  @IsNotBlank()
  name!: unknown;
}

const errorsFor = (value: unknown) => {
  const sample = new Sample();
  sample.name = value;
  return validate(sample);
};

describe('isNotBlank', () => {
  it('odrzuca tekst z samych białych znaków', () => {
    expect(isNotBlank('   ')).toBe(false);
    expect(isNotBlank('\t\n')).toBe(false);
    expect(isNotBlank('')).toBe(false);
  });

  it('przyjmuje tekst z treścią, także w otoczeniu spacji', () => {
    expect(isNotBlank(' Anna ')).toBe(true);
  });

  it('odrzuca wartości nie-tekstowe', () => {
    expect(isNotBlank(undefined)).toBe(false);
    expect(isNotBlank(null)).toBe(false);
    expect(isNotBlank(42)).toBe(false);
  });
});

describe('@IsNotBlank()', () => {
  it('odrzuca same spacje — czego @IsNotEmpty() nie robi', async () => {
    const errors = await errorsFor('   ');

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toEqual({ isNotBlank: 'Pole nie może być puste' });
  });

  it('przepuszcza poprawną nazwę', async () => {
    await expect(errorsFor('Salon Anna')).resolves.toEqual([]);
  });
});
