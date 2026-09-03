import * as bcrypt from 'bcrypt';

/** Koszt bcrypta. Jedna stała dla wszystkich dróg zakładania i zmiany hasła — konto
 *  założone przez administratora (#144) ma być tak samo drogie do złamania co własne. */
export const PASSWORD_HASH_ROUNDS = 10;

export const hashPassword = (password: string) =>
  bcrypt.hash(password, PASSWORD_HASH_ROUNDS);

/** E-mail jest identyfikatorem konta, więc do bazy trafia w jednej postaci niezależnie od
 *  tego, kto konto zakłada — inaczej „Jan@example.com" z panelu administratora minąłby się
 *  z „jan@example.com" z logowania. */
export const normalizeEmail = (email: string) => email.trim().toLowerCase();
