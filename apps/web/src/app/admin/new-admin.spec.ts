import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { settle, setValue } from '../public/testing-helpers';
import NewAdmin from './new-admin';

const CREATE_URL = '/api/admin/users';

async function setup() {
  localStorage.clear();
  await TestBed.configureTestingModule({
    imports: [NewAdmin],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(NewAdmin);
  const http = TestBed.inject(HttpTestingController);
  fixture.detectChanges();
  return { fixture, http };
}

type Fixture = ComponentFixture<NewAdmin>;

const html = (fixture: Fixture) => fixture.nativeElement as HTMLElement;

const textOf = (fixture: Fixture) =>
  (html(fixture).textContent ?? '').replace(/\s+/g, ' ').trim();

const input = (fixture: Fixture, id: string) =>
  html(fixture).querySelector<HTMLInputElement>(`#${id}`)!;

const buttonWith = (fixture: Fixture, label: string) =>
  [...html(fixture).querySelectorAll('button')].find((b) =>
    (b.textContent ?? '').includes(label),
  )!;

const fill = (fixture: Fixture, over: Record<string, string> = {}) => {
  const values: Record<string, string> = {
    firstName: 'Jan',
    lastName: 'Nowak',
    email: 'jan@bookit.pl',
    phone: '',
    password: 'startowe-haslo1',
    ...over,
  };
  for (const [id, value] of Object.entries(values)) {
    setValue(input(fixture, id), value);
  }
  fixture.detectChanges();
};

const submitForm = async (fixture: Fixture) => {
  html(fixture).querySelector('form')!.dispatchEvent(new Event('submit'));
  await settle(fixture);
  fixture.detectChanges();
};

const conflict = () => [
  {
    statusCode: 409,
    code: 'CONFLICT',
    message: 'Konto z tym adresem email już istnieje',
  },
  { status: 409, statusText: 'Conflict' },
];

describe('NewAdmin', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('wysyła formularz bez roli i bez pustego telefonu', async () => {
    const { fixture, http } = await setup();
    fill(fixture);

    await submitForm(fixture);

    const req = http.expectOne(CREATE_URL);
    expect(req.request.body).toEqual({
      email: 'jan@bookit.pl',
      firstName: 'Jan',
      lastName: 'Nowak',
      password: 'startowe-haslo1',
    });
    req.flush({ id: 'u2' });
    await settle(fixture);
    fixture.detectChanges();

    expect(textOf(fixture)).toContain('Konto jan@bookit.pl zostało utworzone.');
    // hasło zostaje na ekranie — administrator musi je przekazać poza systemem
    expect(
      html(fixture).querySelector('[data-testid="created-password"]')
        ?.textContent,
    ).toBe('startowe-haslo1');
  });

  it('dokłada telefon, gdy został podany', async () => {
    const { fixture, http } = await setup();
    fill(fixture, { phone: '600100200' });

    await submitForm(fixture);

    const req = http.expectOne(CREATE_URL);
    expect(req.request.body).toMatchObject({ phone: '600100200' });
    req.flush({ id: 'u2' });
    await settle(fixture);
  });

  it('„Generuj hasło" wypełnia widoczne pole hasłem spełniającym walidację', async () => {
    const { fixture } = await setup();
    fill(fixture, { password: '' });
    // ręcznie wpisane hasło startuje zakryte
    expect(input(fixture, 'password').type).toBe('password');

    buttonWith(fixture, 'Generuj hasło').click();
    fixture.detectChanges();

    const password = input(fixture, 'password');
    expect(password.type).toBe('text');
    expect(password.value.length).toBeGreaterThanOrEqual(8);
    expect(textOf(fixture)).not.toContain('Hasło musi mieć co najmniej');

    buttonWith(fixture, 'Ukryj hasło').click();
    fixture.detectChanges();
    expect(input(fixture, 'password').type).toBe('password');
  });

  it('obcina spacje na brzegach danych osobowych', async () => {
    const { fixture, http } = await setup();
    fill(fixture, {
      firstName: ' Jan ',
      lastName: ' Nowak ',
      email: ' Jan@Bookit.pl ',
      phone: ' 600100200 ',
    });

    await submitForm(fixture);

    const req = http.expectOne(CREATE_URL);
    expect(req.request.body).toMatchObject({
      firstName: 'Jan',
      lastName: 'Nowak',
      email: 'Jan@Bookit.pl',
      phone: '600100200',
    });
    req.flush({ id: 'u2' });
    await settle(fixture);
  });

  it('409 pokazuje komunikat przy polu e-mail, nie jako błąd ogólny', async () => {
    const { fixture, http } = await setup();
    fill(fixture);

    await submitForm(fixture);
    http.expectOne(CREATE_URL).flush(...(conflict() as [object, object]));
    await settle(fixture);
    fixture.detectChanges();

    const emailError = html(fixture).querySelector('#email-err');
    expect(emailError?.textContent).toContain(
      'Konto z tym adresem email już istnieje',
    );
    expect(html(fixture).querySelector('[role="alert"].alert-danger')).toBeNull();
    expect(input(fixture, 'email').getAttribute('aria-invalid')).toBe('true');
  });

  it('po poprawieniu e-maila konflikt znika i formularz wysyła się ponownie', async () => {
    const { fixture, http } = await setup();
    fill(fixture);
    await submitForm(fixture);
    http.expectOne(CREATE_URL).flush(...(conflict() as [object, object]));
    await settle(fixture);
    fixture.detectChanges();

    setValue(input(fixture, 'email'), 'jan.nowak@bookit.pl');
    fixture.detectChanges();
    expect(html(fixture).querySelector('#email-err')).toBeNull();

    await submitForm(fixture);
    http.expectOne(CREATE_URL).flush({ id: 'u2' });
    await settle(fixture);
  });

  it('błąd inny niż 409 ląduje nad formularzem', async () => {
    const { fixture, http } = await setup();
    fill(fixture);

    await submitForm(fixture);
    http
      .expectOne(CREATE_URL)
      .flush(null, { status: 500, statusText: 'Server Error' });
    await settle(fixture);
    fixture.detectChanges();

    expect(
      html(fixture).querySelector('[role="alert"].alert-danger')?.textContent,
    ).toContain('błąd serwera');
  });

  it('nie wysyła niczego przy pustym formularzu', async () => {
    const { fixture, http } = await setup();

    await submitForm(fixture);

    http.expectNone(CREATE_URL);
    expect(textOf(fixture)).toContain('Imię jest wymagane');
  });
});
