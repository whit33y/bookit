import { ComponentFixture } from '@angular/core/testing';

/** Wpisuje wartość jak użytkownik — event 'input' aktualizuje Signal Forms. Także dla
 *  `<textarea>`: z punktu widzenia formularza to ten sam kontrakt (value + input). */
export const setValue = (
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) => {
  input.value = value;
  input.dispatchEvent(new Event('input'));
};

/** Tick makrotaska + stabilizacja: łańcuch promisów submit() musi się
 *  rozliczyć przed asercją. */
export const settle = async (fixture: ComponentFixture<unknown>) => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await fixture.whenStable();
};
