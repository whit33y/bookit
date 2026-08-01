import { Component, computed, input } from '@angular/core';
import { WritableSignal } from '@angular/core';
import {
  Field,
  FieldTree,
  FormField,
  email,
  maxLength,
  minLength,
  pattern,
  required,
  schema,
  submit,
} from '@angular/forms/signals';
import { apiErrorMessage } from '../../core/api-client';

// backendowy @IsEmail() wymaga TLD, a email() Angulara nie — bez tego 'a@b' przechodziłby
// walidację klienta i wracał z serwera jako angielski błąd 400
export const EMAIL_WITH_TLD = /^\S+@\S+\.\S+$/;

/** Wspólne reguły pola email stron auth — w komponencie: apply(p.email, emailSchema). */
export const emailSchema = schema<string>((p) => {
  required(p, { message: 'Email jest wymagany' });
  email(p, { message: 'Nieprawidłowy format adresu email' });
  pattern(p, EMAIL_WITH_TLD, {
    message: 'Nieprawidłowy format adresu email',
  });
});

/** Limit imienia i nazwiska — lustro NAME_MAX_LENGTH z apps/api (auth.dto.ts). Bez tej
 *  reguły przekroczenie limitu wychodzi dopiero z serwera jako jeden ogólny komunikat
 *  nad formularzem, bez wskazania pola. */
export const NAME_MAX_LENGTH = 50;

/** Reguły imienia/nazwiska — register (i każdy przyszły formularz profilu). */
export function personNameSchema(label: string) {
  return schema<string>((p) => {
    required(p, { message: `${label} jest wymagane` });
    maxLength(p, NAME_MAX_LENGTH, {
      message: `${label} może mieć maksymalnie ${NAME_MAX_LENGTH} znaków`,
    });
  });
}

/** Reguły nowego hasła zgodne z backendowym DTO (8–72 znaki) — register i reset hasła. */
export const passwordSchema = schema<string>((p) => {
  required(p, { message: 'Hasło jest wymagane' });
  minLength(p, 8, { message: 'Hasło musi mieć co najmniej 8 znaków' });
  maxLength(p, 72, { message: 'Hasło może mieć maksymalnie 72 znaki' });
});

/** Etykieta + input spięty z Signal Forms + inline błąd walidacji (wzorce z design systemu). */
@Component({
  selector: 'app-form-field',
  imports: [FormField],
  host: { class: 'block' },
  template: `
    <label [for]="fieldId()" class="mb-1.5 block text-sm font-medium">
      {{ label() }}
    </label>
    <input
      [formField]="field()"
      [id]="fieldId()"
      [type]="type()"
      [attr.autocomplete]="autocomplete() || null"
      class="w-full rounded-lg border bg-white px-3.5 py-2 text-sm placeholder-stone-400 shadow-card transition focus:outline-none focus:ring-2"
      [class]="
        showError()
          ? 'border-rose-600 focus:ring-rose-600/20'
          : 'border-stone-300 focus:border-brand-600 focus:ring-brand-ring'
      "
      [attr.aria-invalid]="showError()"
      [attr.aria-describedby]="showError() ? errorId() : null"
    />
    @if (showError()) {
      <p [id]="errorId()" class="mt-1.5 text-[13px] font-medium text-rose-600">
        {{ field()().errors()[0]?.message }}
      </p>
    }
  `,
})
export default class AppFormField {
  readonly field = input.required<Field<string>>();
  readonly label = input.required<string>();
  readonly fieldId = input.required<string>();
  readonly type = input('text');
  readonly autocomplete = input('');

  protected readonly showError = computed(
    () => this.field()().touched() && this.field()().invalid(),
  );
  protected readonly errorId = computed(() => `${this.fieldId()}-err`);
}

/** Wspólny submit stron auth: czyści błąd serwera, odpala akcję przez submit()
 *  (który sam oznacza pola jako touched i pomija akcję przy błędach walidacji),
 *  a błąd API zamienia na polski komunikat. */
export async function submitAuthForm<T>(
  form: FieldTree<T>,
  serverError: WritableSignal<string | null>,
  action: () => Promise<void>,
): Promise<void> {
  serverError.set(null);
  await submit(form, async () => {
    try {
      await action();
    } catch (err) {
      serverError.set(apiErrorMessage(err));
    }
    return undefined;
  });
}
