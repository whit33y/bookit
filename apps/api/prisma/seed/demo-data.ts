import { BookingStatus, UserRole } from '@prisma/client';

/**
 * Deklaratywny opis danych demo — bez ani jednego wywołania Prismy, żeby dało się go
 * przetestować i przejrzeć jak zwykłą tabelkę. Zapis do bazy siedzi w `seed-demo.ts`,
 * a przeliczanie terminów rezerwacji na instanty — w `demo-bookings.ts`.
 *
 * Rekordy wiążemy tu naturalnymi kluczami (e-mail, slug firmy, nazwa pracownika/usługi),
 * nie identyfikatorami: id nadaje baza, a seed ma być idempotentny na istniejącej bazie.
 */

// Hasło wspólne dla wszystkich kont demo, żeby dało się je zapamiętać przy przeglądaniu
// aplikacji; dokumentacja: README.md i docs/users.md. NIE używać na środowisku publicznym.
export const DEMO_PASSWORD = 'Haslo123!';

// slug ASCII (bez diakrytyków) — trafia do URL-i /businesses?category=<slug>
export const CATEGORIES = [
  { name: 'Fryzjer', slug: 'fryzjer' },
  { name: 'Barber', slug: 'barber' },
  { name: 'Paznokcie', slug: 'paznokcie' },
  { name: 'Kosmetyczka', slug: 'kosmetyczka' },
  { name: 'Fizjoterapeuta', slug: 'fizjoterapeuta' },
  { name: 'Masaż', slug: 'masaz' },
  { name: 'Groomer', slug: 'groomer' },
  { name: 'Tatuaż', slug: 'tatuaz' },
];

export interface DemoUser {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  role: UserRole;
}

export interface DemoWorkingHours {
  weekday: number; // 0 = poniedziałek … 6 = niedziela (konwencja Prismy)
  startTime: string; // "09:00", czas lokalny firmy
  endTime: string;
}

export interface DemoEmployee {
  name: string;
  /** e-mail konta w systemie; pracownik może go nie mieć (Employee.userId jest opcjonalne) */
  userEmail?: string;
  workingHours: DemoWorkingHours[];
}

export interface DemoService {
  name: string;
  description: string;
  durationMin: number;
  priceCents: number;
  /** pracownicy wykonujący usługę — nazwy z `employees` tej samej firmy */
  employeeNames: string[];
}

export interface DemoBusiness {
  slug: string;
  name: string;
  description: string;
  phone: string;
  street: string;
  city: string;
  postalCode: string;
  lat: number;
  lng: number;
  categorySlug: string;
  ownerEmail: string;
  cancellationHours: number;
  isBlocked?: boolean;
  employees: DemoEmployee[];
  services: DemoService[];
}

/**
 * Urlop opisany dniami roboczymi pracownika — `demo-bookings.ts` zamienia go na instanty.
 * Doby kalendarzowe by tu nie wystarczyły: seed odpalony w piątek wstawiłby „urlop” na sobotę
 * i niedzielę, czyli w kalendarzu nie zniknąłby ani jeden dzień pracy.
 */
export interface DemoTimeOffSpec {
  businessSlug: string;
  employeeName: string;
  /** od którego dnia roboczego pracownika, licząc od jutra */
  startWorkdayOffset: number;
  /** ile kolejnych dni roboczych obejmuje (weekend pomiędzy wchodzi w zakres) */
  workdays: number;
  reason: string;
}

export interface DemoReviewSpec {
  rating: number; // 1–5
  comment?: string;
}

export interface DemoBookingSpec {
  businessSlug: string;
  employeeName: string;
  serviceName: string;
  clientEmail: string;
  status: BookingStatus;
  /**
   * Przesunięcie w **dniach roboczych pracownika**, liczone od jutra (dodatnie) albo od wczoraj
   * (ujemne) — 0 jest niedozwolone. Dzięki temu przeszłe wizyty zawsze leżą przed `now`,
   * a przyszłe po nim, niezależnie od tego, o której ktoś odpala seed.
   */
  workdayOffset: number;
  startTime: string; // "11:00", czas lokalny firmy
  clientNote?: string;
  /**
   * Recenzja wisi przy rezerwacji, a nie na osobnej liście z kluczem naturalnym: inaczej dałoby
   * się wskazać nieistniejącą wizytę albo wystawić dwie recenzje do jednej. Dozwolona wyłącznie
   * przy `COMPLETED` — pilnuje tego `assertValidReview` w `demo-bookings.ts`.
   */
  review?: DemoReviewSpec;
}

const MON_FRI = [0, 1, 2, 3, 4];

const hours = (
  weekdays: number[],
  startTime: string,
  endTime: string,
): DemoWorkingHours[] =>
  weekdays.map((weekday) => ({ weekday, startTime, endTime }));

const ADMIN: DemoUser = {
  email: 'admin@bookit.pl',
  firstName: 'Admin',
  lastName: 'Bookit',
  phone: '600100100',
  role: UserRole.ADMIN,
};

export const DEMO_CLIENTS: DemoUser[] = [
  {
    email: 'klient@bookit.pl',
    firstName: 'Kinga',
    lastName: 'Nowak',
    phone: '600200200',
    role: UserRole.CLIENT,
  },
  {
    email: 'klient2@bookit.pl',
    firstName: 'Bartosz',
    lastName: 'Wróbel',
    phone: '600200201',
    role: UserRole.CLIENT,
  },
  {
    email: 'klient3@bookit.pl',
    firstName: 'Zofia',
    lastName: 'Duda',
    phone: '600200202',
    role: UserRole.CLIENT,
  },
];

export const DEMO_OWNERS: DemoUser[] = [
  {
    email: 'wlasciciel@bookit.pl',
    firstName: 'Anna',
    lastName: 'Kowalska',
    phone: '600300300',
    role: UserRole.OWNER,
  },
  {
    email: 'wlasciciel2@bookit.pl',
    firstName: 'Piotr',
    lastName: 'Adamczyk',
    phone: '600300301',
    role: UserRole.OWNER,
  },
  {
    email: 'wlasciciel3@bookit.pl',
    firstName: 'Magdalena',
    lastName: 'Krawczyk',
    phone: '600300302',
    role: UserRole.OWNER,
  },
  {
    email: 'wlasciciel4@bookit.pl',
    firstName: 'Agnieszka',
    lastName: 'Wójcik',
    phone: '600300303',
    role: UserRole.OWNER,
  },
  {
    email: 'wlasciciel5@bookit.pl',
    firstName: 'Rafał',
    lastName: 'Jankowski',
    phone: '600300304',
    role: UserRole.OWNER,
  },
  {
    email: 'wlasciciel6@bookit.pl',
    firstName: 'Sebastian',
    lastName: 'Nowicki',
    phone: '600300305',
    role: UserRole.OWNER,
  },
];

export const DEMO_EMPLOYEE_USERS: DemoUser[] = [
  {
    email: 'pracownik@bookit.pl',
    firstName: 'Marek',
    lastName: 'Wiśniewski',
    phone: '600400400',
    role: UserRole.EMPLOYEE,
  },
  {
    email: 'barber@bookit.pl',
    firstName: 'Tomasz',
    lastName: 'Lewandowski',
    phone: '600400401',
    role: UserRole.EMPLOYEE,
  },
];

export const DEMO_USERS: DemoUser[] = [
  ADMIN,
  ...DEMO_OWNERS,
  ...DEMO_EMPLOYEE_USERS,
  ...DEMO_CLIENTS,
];

/**
 * Sześć firm w pięciu kategoriach i sześciu miastach — współrzędne prawdziwe, bo wyszukiwarka
 * sortuje po odległości (Haversine w `businesses.service.ts`), a mapa stawia po nich piny.
 * Ostatnia jest zablokowana: panel admina (#41) ma co odblokowywać, a wyszukiwarka
 * i availability i tak jej nie pokażą.
 */
export const DEMO_BUSINESSES: DemoBusiness[] = [
  {
    slug: 'studio-nozyczki',
    name: 'Studio Fryzur „Nożyczki”',
    description:
      'Kameralne studio w sercu Kazimierza. Strzyżenia, koloryzacja i stylizacja.',
    phone: '123456789',
    street: 'Józefa 12',
    city: 'Kraków',
    postalCode: '31-056',
    lat: 50.0498,
    lng: 19.9455,
    categorySlug: 'fryzjer',
    ownerEmail: 'wlasciciel@bookit.pl',
    cancellationHours: 24,
    employees: [
      {
        name: 'Marek Wiśniewski',
        userEmail: 'pracownik@bookit.pl',
        workingHours: hours(MON_FRI, '09:00', '17:00'),
      },
      {
        name: 'Ewa Zielińska',
        workingHours: [
          ...hours(MON_FRI, '11:00', '19:00'),
          ...hours([5], '10:00', '14:00'),
        ],
      },
    ],
    services: [
      {
        name: 'Strzyżenie męskie',
        description: 'Klasyczne lub maszynką, ze stylizacją.',
        durationMin: 30,
        priceCents: 7000,
        employeeNames: ['Marek Wiśniewski', 'Ewa Zielińska'],
      },
      {
        name: 'Strzyżenie damskie z modelowaniem',
        description: 'Mycie, strzyżenie i modelowanie suszarką.',
        durationMin: 60,
        priceCents: 12000,
        employeeNames: ['Ewa Zielińska'],
      },
      {
        name: 'Koloryzacja',
        description: 'Farbowanie całości wraz z pielęgnacją i modelowaniem.',
        durationMin: 90,
        priceCents: 22000,
        employeeNames: ['Ewa Zielińska'],
      },
    ],
  },
  {
    slug: 'barber-brzytwa',
    name: 'Barber Shop „Brzytwa”',
    description: 'Męski zakład na Chmielnej. Broda, włosy i gorący ręcznik.',
    phone: '223334455',
    street: 'Chmielna 21',
    city: 'Warszawa',
    postalCode: '00-021',
    lat: 52.233,
    lng: 21.013,
    categorySlug: 'barber',
    ownerEmail: 'wlasciciel2@bookit.pl',
    cancellationHours: 12,
    employees: [
      {
        name: 'Tomasz Lewandowski',
        userEmail: 'barber@bookit.pl',
        workingHours: [
          ...hours(MON_FRI, '10:00', '18:00'),
          ...hours([5], '10:00', '15:00'),
        ],
      },
      {
        name: 'Kamil Dąbrowski',
        workingHours: hours([1, 2, 3, 4, 5], '12:00', '20:00'),
      },
    ],
    services: [
      {
        name: 'Strzyżenie brody',
        description: 'Modelowanie i konturowanie brody, olejek na koniec.',
        durationMin: 30,
        priceCents: 6000,
        employeeNames: ['Tomasz Lewandowski', 'Kamil Dąbrowski'],
      },
      {
        name: 'Strzyżenie włosów i brody',
        description: 'Pełny zestaw: włosy, broda i stylizacja.',
        durationMin: 60,
        priceCents: 11000,
        employeeNames: ['Tomasz Lewandowski', 'Kamil Dąbrowski'],
      },
      {
        name: 'Golenie brzytwą',
        description: 'Tradycyjne golenie z gorącym ręcznikiem.',
        durationMin: 45,
        priceCents: 8000,
        employeeNames: ['Tomasz Lewandowski'],
      },
    ],
  },
  {
    slug: 'studio-lakier',
    name: 'Studio Paznokci „Lakier”',
    description: 'Manicure hybrydowy i przedłużanie paznokci przy Świdnickiej.',
    phone: '713334455',
    street: 'Świdnicka 8',
    city: 'Wrocław',
    postalCode: '50-067',
    lat: 51.1055,
    lng: 17.0326,
    categorySlug: 'paznokcie',
    ownerEmail: 'wlasciciel3@bookit.pl',
    cancellationHours: 24,
    employees: [
      {
        name: 'Julia Mazur',
        workingHours: hours(MON_FRI, '09:00', '17:00'),
      },
      {
        name: 'Oliwia Kaczmarek',
        workingHours: hours([0, 1, 2, 3, 4, 5], '12:00', '20:00'),
      },
    ],
    services: [
      {
        name: 'Manicure hybrydowy',
        description: 'Opracowanie płytki i lakier hybrydowy.',
        durationMin: 60,
        priceCents: 12000,
        employeeNames: ['Julia Mazur', 'Oliwia Kaczmarek'],
      },
      {
        name: 'Przedłużanie paznokci',
        description: 'Metoda żelowa na formie, z lakierem hybrydowym.',
        durationMin: 90,
        priceCents: 20000,
        employeeNames: ['Oliwia Kaczmarek'],
      },
      {
        name: 'Manicure klasyczny',
        description: 'Opracowanie skórek i lakier klasyczny.',
        durationMin: 45,
        priceCents: 8000,
        employeeNames: ['Julia Mazur'],
      },
    ],
  },
  {
    slug: 'gabinet-aura',
    name: 'Gabinet Kosmetyczny „Aura”',
    description: 'Zabiegi na twarz i pielęgnacja w gdańskiej Starówce.',
    phone: '583334455',
    street: 'Długa 45',
    city: 'Gdańsk',
    postalCode: '80-831',
    lat: 54.3489,
    lng: 18.653,
    categorySlug: 'kosmetyczka',
    ownerEmail: 'wlasciciel4@bookit.pl',
    cancellationHours: 48,
    employees: [
      {
        name: 'Natalia Szymańska',
        workingHours: hours(MON_FRI, '08:00', '16:00'),
      },
    ],
    services: [
      {
        name: 'Oczyszczanie manualne twarzy',
        description: 'Peeling, oczyszczanie i maska dopasowana do cery.',
        durationMin: 90,
        priceCents: 18000,
        employeeNames: ['Natalia Szymańska'],
      },
      {
        name: 'Peeling kawitacyjny',
        description: 'Bezinwazyjne oczyszczanie ultradźwiękami.',
        durationMin: 60,
        priceCents: 15000,
        employeeNames: ['Natalia Szymańska'],
      },
      {
        name: 'Regulacja i henna brwi',
        description: 'Nadanie kształtu i koloryzacja henną.',
        durationMin: 30,
        priceCents: 5000,
        employeeNames: ['Natalia Szymańska'],
      },
    ],
  },
  {
    slug: 'studio-relaks',
    name: 'Studio Masażu „Relaks”',
    description: 'Masaże relaksacyjne i lecznicze w centrum Poznania.',
    phone: '613334455',
    street: 'Półwiejska 17',
    city: 'Poznań',
    postalCode: '61-888',
    lat: 52.403,
    lng: 16.9245,
    categorySlug: 'masaz',
    ownerEmail: 'wlasciciel5@bookit.pl',
    cancellationHours: 24,
    employees: [
      {
        name: 'Paweł Górski',
        workingHours: hours(MON_FRI, '10:00', '18:00'),
      },
      {
        name: 'Iwona Pawlak',
        workingHours: hours([0, 2, 4], '14:00', '20:00'),
      },
    ],
    services: [
      {
        name: 'Masaż relaksacyjny całego ciała',
        description: 'Spokojne tempo, ciepłe olejki, muzyka relaksacyjna.',
        durationMin: 60,
        priceCents: 16000,
        employeeNames: ['Paweł Górski', 'Iwona Pawlak'],
      },
      {
        name: 'Masaż gorącymi kamieniami',
        description:
          'Bazalt rozgrzewający mięśnie, zabieg dla dwojga na życzenie.',
        durationMin: 90,
        priceCents: 25000,
        employeeNames: ['Iwona Pawlak'],
      },
      {
        name: 'Masaż pleców',
        description: 'Krótki masaż odcinka szyjnego i lędźwiowego.',
        durationMin: 30,
        priceCents: 9000,
        employeeNames: ['Paweł Górski'],
      },
    ],
  },
  {
    slug: 'salon-azor',
    name: 'Salon dla psów „Azor”',
    description:
      'Strzyżenie i pielęgnacja psów. Firma zablokowana — przykład dla admina.',
    phone: '323334455',
    street: 'Mariacka 5',
    city: 'Katowice',
    postalCode: '40-014',
    lat: 50.2584,
    lng: 19.0275,
    categorySlug: 'groomer',
    ownerEmail: 'wlasciciel6@bookit.pl',
    cancellationHours: 24,
    isBlocked: true,
    employees: [
      {
        name: 'Weronika Sikora',
        workingHours: hours(MON_FRI, '09:00', '17:00'),
      },
    ],
    services: [
      {
        name: 'Strzyżenie psa małej rasy',
        description: 'Kąpiel, strzyżenie i pazurki.',
        durationMin: 60,
        priceCents: 12000,
        employeeNames: ['Weronika Sikora'],
      },
      {
        name: 'Kąpiel i suszenie',
        description: 'Mycie szamponem dobranym do sierści i suszenie.',
        durationMin: 45,
        priceCents: 8000,
        employeeNames: ['Weronika Sikora'],
      },
    ],
  },
];

/** Urlop w kalendarzu firmy demo — żeby w widoku pracownika było widać zablokowane dni. */
export const DEMO_TIME_OFFS: DemoTimeOffSpec[] = [
  {
    businessSlug: 'studio-nozyczki',
    employeeName: 'Marek Wiśniewski',
    startWorkdayOffset: 6,
    workdays: 2,
    reason: 'Urlop',
  },
];

/**
 * Rezerwacje we wszystkich sześciu statusach `BookingStatus`, część `COMPLETED` z recenzją.
 *
 * Świadomie nie ma tu przeszłego `CONFIRMED`: cron auto-domykania (#39) przerobiłby je na
 * `COMPLETED` w kwadrans po starcie API i historia rozjechałaby się względem dokumentacji.
 * Najbliższe `CONFIRMED` leży 2 dni robocze w przód, czyli poza oknem przypomnień
 * (2 h – 24,25 h), więc świeży seed nie wysyła od razu maila.
 *
 * Recenzje (#46) rozłożone tak, żeby dało się pokazać cały zakres UI: firmy z kilkoma ocenami
 * i różną średnią, firma z jedną oceną, firma zupełnie bez ocen (`gabinet-aura`) oraz jedna
 * wizyta `COMPLETED` Kingi bez recenzji — bez niej nie ma na czym przeklikać „oceń wizytę”.
 */
export const DEMO_BOOKINGS: DemoBookingSpec[] = [
  // Kinga Nowak — główne konto klienta, ma pełny przekrój „Moich wizyt”
  {
    businessSlug: 'studio-nozyczki',
    employeeName: 'Marek Wiśniewski',
    serviceName: 'Strzyżenie męskie',
    clientEmail: 'klient@bookit.pl',
    status: BookingStatus.COMPLETED,
    workdayOffset: -9,
    startTime: '10:00',
    review: {
      rating: 5,
      comment: 'Dokładnie tak, jak prosiłam. Marek nie spieszy się z klientem.',
    },
  },
  {
    businessSlug: 'studio-lakier',
    employeeName: 'Julia Mazur',
    serviceName: 'Manicure hybrydowy',
    clientEmail: 'klient@bookit.pl',
    status: BookingStatus.COMPLETED,
    workdayOffset: -5,
    startTime: '10:00',
    review: { rating: 5 }, // recenzja bez komentarza — sama ocena też jest poprawna
  },
  {
    // jedyna wizyta COMPLETED Kingi bez recenzji — celowo, pod akcję „oceń wizytę” (#48)
    businessSlug: 'studio-relaks',
    employeeName: 'Paweł Górski',
    serviceName: 'Masaż pleców',
    clientEmail: 'klient@bookit.pl',
    status: BookingStatus.COMPLETED,
    workdayOffset: -2,
    startTime: '11:00',
    clientNote: 'Proszę o mocniejszy nacisk na barki.',
  },
  {
    businessSlug: 'studio-lakier',
    employeeName: 'Julia Mazur',
    serviceName: 'Manicure klasyczny',
    clientEmail: 'klient@bookit.pl',
    status: BookingStatus.CANCELLED_BY_CLIENT,
    workdayOffset: -3,
    startTime: '13:00',
  },
  {
    businessSlug: 'barber-brzytwa',
    employeeName: 'Tomasz Lewandowski',
    serviceName: 'Golenie brzytwą',
    clientEmail: 'klient@bookit.pl',
    status: BookingStatus.DECLINED,
    workdayOffset: -5,
    startTime: '15:00',
  },
  {
    businessSlug: 'gabinet-aura',
    employeeName: 'Natalia Szymańska',
    serviceName: 'Regulacja i henna brwi',
    clientEmail: 'klient@bookit.pl',
    status: BookingStatus.CANCELLED_BY_BUSINESS,
    workdayOffset: -1,
    startTime: '09:00',
  },
  {
    businessSlug: 'studio-nozyczki',
    employeeName: 'Marek Wiśniewski',
    serviceName: 'Strzyżenie męskie',
    clientEmail: 'klient@bookit.pl',
    status: BookingStatus.PENDING,
    workdayOffset: 1,
    startTime: '12:00',
    clientNote: 'Poproszę na krótko po bokach.',
  },
  {
    businessSlug: 'studio-lakier',
    employeeName: 'Oliwia Kaczmarek',
    serviceName: 'Manicure hybrydowy',
    clientEmail: 'klient@bookit.pl',
    status: BookingStatus.CONFIRMED,
    workdayOffset: 2,
    startTime: '14:00',
  },
  {
    businessSlug: 'studio-relaks',
    employeeName: 'Iwona Pawlak',
    serviceName: 'Masaż gorącymi kamieniami',
    clientEmail: 'klient@bookit.pl',
    status: BookingStatus.CONFIRMED,
    workdayOffset: 5,
    startTime: '15:00',
  },

  // Bartosz Wróbel
  {
    businessSlug: 'barber-brzytwa',
    employeeName: 'Kamil Dąbrowski',
    serviceName: 'Strzyżenie brody',
    clientEmail: 'klient2@bookit.pl',
    status: BookingStatus.COMPLETED,
    workdayOffset: -4,
    startTime: '13:00',
    review: { rating: 5, comment: 'Broda wymodelowana perfekcyjnie, wrócę.' },
  },
  {
    businessSlug: 'barber-brzytwa',
    employeeName: 'Tomasz Lewandowski',
    serviceName: 'Strzyżenie włosów i brody',
    clientEmail: 'klient2@bookit.pl',
    status: BookingStatus.COMPLETED,
    workdayOffset: -8,
    startTime: '11:00',
    review: {
      rating: 4,
      comment: 'Dobre strzyżenie, ale czekałem kwadrans ponad termin.',
    },
  },
  {
    businessSlug: 'studio-nozyczki',
    employeeName: 'Ewa Zielińska',
    serviceName: 'Strzyżenie męskie',
    clientEmail: 'klient2@bookit.pl',
    status: BookingStatus.COMPLETED,
    workdayOffset: -3,
    startTime: '12:00',
    review: {
      rating: 4,
      comment: 'Szybko i konkretnie, bez namawiania na dodatki.',
    },
  },
  {
    businessSlug: 'studio-lakier',
    employeeName: 'Oliwia Kaczmarek',
    serviceName: 'Manicure hybrydowy',
    clientEmail: 'klient2@bookit.pl',
    status: BookingStatus.COMPLETED,
    workdayOffset: -2,
    startTime: '18:00',
    review: {
      rating: 2,
      comment: 'Hybryda zaczęła schodzić po tygodniu, reklamacji nie uznano.',
    },
  },
  {
    businessSlug: 'barber-brzytwa',
    employeeName: 'Tomasz Lewandowski',
    serviceName: 'Strzyżenie włosów i brody',
    clientEmail: 'klient2@bookit.pl',
    status: BookingStatus.PENDING,
    workdayOffset: 1,
    startTime: '11:00',
  },
  {
    businessSlug: 'studio-nozyczki',
    employeeName: 'Marek Wiśniewski',
    serviceName: 'Strzyżenie męskie',
    clientEmail: 'klient2@bookit.pl',
    status: BookingStatus.CONFIRMED,
    workdayOffset: 3,
    startTime: '09:00',
  },

  // Zofia Duda
  {
    businessSlug: 'studio-lakier',
    employeeName: 'Oliwia Kaczmarek',
    serviceName: 'Przedłużanie paznokci',
    clientEmail: 'klient3@bookit.pl',
    status: BookingStatus.COMPLETED,
    workdayOffset: -6,
    startTime: '16:00',
    review: {
      rating: 4,
      comment: 'Ładna robota, choć zabieg przeciągnął się o pół godziny.',
    },
  },
  {
    // „kolor jak ostatnio” z rezerwacji poniżej odnosi się właśnie do tej wizyty
    businessSlug: 'studio-nozyczki',
    employeeName: 'Ewa Zielińska',
    serviceName: 'Koloryzacja',
    clientEmail: 'klient3@bookit.pl',
    status: BookingStatus.COMPLETED,
    workdayOffset: -7,
    startTime: '12:00',
    review: {
      rating: 5,
      comment: 'Kolor wyszedł dokładnie taki, jak ustalałyśmy.',
    },
  },
  {
    businessSlug: 'studio-relaks',
    employeeName: 'Iwona Pawlak',
    serviceName: 'Masaż gorącymi kamieniami',
    clientEmail: 'klient3@bookit.pl',
    status: BookingStatus.COMPLETED,
    workdayOffset: -3,
    startTime: '15:00',
    review: {
      rating: 5,
      comment: 'Godzina i pół pełnego wyłączenia. Polecam.',
    },
  },
  {
    businessSlug: 'studio-nozyczki',
    employeeName: 'Ewa Zielińska',
    serviceName: 'Koloryzacja',
    clientEmail: 'klient3@bookit.pl',
    status: BookingStatus.PENDING,
    workdayOffset: 2,
    startTime: '13:00',
    clientNote: 'Kolor jak ostatnio, proszę o ten sam odcień.',
  },
  {
    businessSlug: 'studio-relaks',
    employeeName: 'Paweł Górski',
    serviceName: 'Masaż relaksacyjny całego ciała',
    clientEmail: 'klient3@bookit.pl',
    status: BookingStatus.PENDING,
    workdayOffset: 3,
    startTime: '16:00',
  },
  {
    businessSlug: 'gabinet-aura',
    employeeName: 'Natalia Szymańska',
    serviceName: 'Oczyszczanie manualne twarzy',
    clientEmail: 'klient3@bookit.pl',
    status: BookingStatus.CONFIRMED,
    workdayOffset: 4,
    startTime: '10:00',
  },
];
