# Solution Design Document — BookIt

Platforma rezerwacji wizyt u specjalistów (fryzjer, barber, paznokcie, fizjoterapeuta, groomer…) — alternatywa dla Booksy.

|        |                                                                     |
| ------ | ------------------------------------------------------------------- |
| Status | Draft — żywy dokument                                               |
| Data   | 2026-07-17                                                          |
| Stack  | NestJS + PostgreSQL + Prisma · Angular + Tailwind CSS · monorepo Nx |

---

## 1. Wizja i cele

**Problem:** klienci umawiają wizyty telefonicznie albo przez media społecznościowe — bez podglądu wolnych terminów, bez potwierdzeń, z ryzykiem pomyłek. Małe firmy usługowe nie mają taniego narzędzia do zarządzania kalendarzem i pozyskiwania klientów.

**Rozwiązanie:** marketplace, na którym klient znajduje firmę (po kategorii, mieście, frazie lub na mapie), widzi realne wolne terminy i rezerwuje wizytę online. Firma dostaje panel z kalendarzem, zarządzaniem usługami, pracownikami i grafikami.

**Charakter projektu:** side project z ambicjami komercyjnymi — MVP okrojone, ale architektura nie może zamykać drogi do rozwoju (płatności, recenzje, skala).

### Personas i role

| Rola           | Kim jest                         | Co robi w systemie                                                                                                |
| -------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Klient**     | Osoba szukająca usługi           | Wyszukuje firmy, przegląda profile i cenniki, rezerwuje/odwołuje wizyty, widzi historię                           |
| **Właściciel** | Prowadzi firmę usługową          | Zakłada profil firmy, zarządza usługami, pracownikami i grafikami, akceptuje rezerwacje, ustawia politykę odwołań |
| **Pracownik**  | Specjalista zatrudniony w firmie | Widzi swój kalendarz i rezerwacje przypisane do siebie                                                            |
| **Admin**      | Operator platformy               | Przegląda firmy i użytkowników, blokuje naruszające zasady                                                        |

---

## 2. Zakres

### MVP

- Rejestracja i logowanie (email + hasło, JWT + refresh, reset hasła mailem)
- Samoobsługowe zakładanie profilu firmy (od razu widoczna publicznie)
- CRUD usług (nazwa, opis, czas trwania, cena informacyjna) i pracowników
- Tygodniowe grafiki pracowników + urlopy/wyjątki; sloty wyliczane automatycznie
- Wyszukiwarka: kategoria + miasto + fraza **oraz** geolokalizacja z mapą (Leaflet + OpenStreetMap)
- Flow rezerwacji: usługa → pracownik → termin → rezerwacja `PENDING` → akceptacja/odrzucenie przez firmę
- Polityka odwołań konfigurowalna per firma („klient może odwołać do X godzin przed")
- Panel firmy: kalendarz dzień/tydzień per pracownik + lista oczekujących rezerwacji
- Powiadomienia email: potwierdzenie, odwołanie, przypomnienie ~24 h przed wizytą
- Panel admina: lista firm/użytkowników, blokowanie firm
- Interfejs wyłącznie po polsku (angielski dochodzi w Fazie 2, §6)
- Uruchamianie przez Docker Compose (Postgres + Mailpit) lokalnie

### Faza 2 (świadomie poza MVP)

- Recenzje i oceny firm (po odbytej wizycie)
- Płatności online / zaliczki (Stripe), prowizje platformy
- Powiadomienia in-app i SMS
- Statystyki/dashboard dla firm
- i18n (angielski) — **zrobione** (#57), opis mechanizmu w §6
- Deploy chmurowy + CI/CD
- PostGIS, gdy prosty Haversine przestanie wystarczać

---

## 3. User stories

### Epik: Konta i autentykacja

- Jako **gość** mogę założyć konto (email, hasło, imię), aby rezerwować wizyty.
- Jako **użytkownik** mogę się zalogować i pozostać zalogowanym (refresh token).
- Jako **użytkownik** mogę zresetować hasło linkiem wysłanym na email.
- Jako **klient** mogę przekształcić konto w konto firmowe, zakładając profil firmy.

### Epik: Katalog i wyszukiwanie

- Jako **klient** mogę wyszukać firmy po kategorii, mieście i frazie.
- Jako **klient** mogę zobaczyć firmy w mojej okolicy na mapie i posortować po odległości.
- Jako **klient** mogę otworzyć profil firmy: opis, adres, cennik usług, pracowników.

### Epik: Rezerwacje

- Jako **klient** wybieram usługę i pracownika (lub „dowolny") i widzę wolne terminy.
- Jako **klient** rezerwuję termin; rezerwacja czeka na akceptację firmy.
- Jako **klient** mogę odwołać wizytę, o ile mieszczę się w polityce odwołań firmy.
- Jako **klient** widzę listę nadchodzących i minionych wizyt ze statusami.
- Jako **klient** dostaję email po potwierdzeniu/odrzuceniu/odwołaniu i przypomnienie ~24 h przed wizytą.

### Epik: Panel firmy

- Jako **właściciel** tworzę profil firmy: nazwa, kategoria, opis, adres (geokodowany na mapie), polityka odwołań.
- Jako **właściciel** zarządzam usługami (czas trwania, cena) i przypisuję je pracownikom.
- Jako **właściciel** dodaję pracowników i ustawiam ich tygodniowe grafiki oraz urlopy.
- Jako **właściciel** widzę kalendarz (dzień/tydzień) z rezerwacjami per pracownik.
- Jako **właściciel** akceptuję lub odrzucam oczekujące rezerwacje; mogę też odwołać każdą wizytę.
- Jako **pracownik** widzę własny kalendarz i szczegóły swoich wizyt.

### Epik: Administracja

- Jako **admin** przeglądam listę firm i użytkowników.
- Jako **admin** blokuję firmę naruszającą zasady — znika z wyszukiwarki, nie przyjmuje rezerwacji.

---

## 4. Model danych

```mermaid
erDiagram
    User ||--o{ Booking : "rezerwuje"
    User ||--o| Business : "posiada"
    User ||--o| Employee : "jest (opcjonalnie)"
    User ||--o{ RefreshToken : ""
    Category ||--o{ Business : ""
    Business ||--o{ Employee : ""
    Business ||--o{ Service : ""
    Business ||--o{ Booking : ""
    Employee ||--o{ WorkingHours : ""
    Employee ||--o{ TimeOff : ""
    Employee ||--o{ Booking : ""
    Service ||--o{ Booking : ""
    Employee }o--o{ Service : "wykonuje"
    Booking ||--o| Payment : "zaliczka (Faza 2)"
    User ||--o{ Notification : "dostaje in-app (Faza 2)"
    Booking ||--o{ Notification : "generuje (Faza 2)"
```

### Szkic `schema.prisma`

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum UserRole {
  CLIENT
  OWNER
  EMPLOYEE
  ADMIN
}

// Faza 2, płatności (#50)
enum DepositType {
  FIXED
  PERCENT
}

// Faza 2, powiadomienia in-app (#54)
enum NotificationType {
  BOOKING_CREATED
  BOOKING_CONFIRMED
  BOOKING_DECLINED
  BOOKING_CANCELLED_BY_CLIENT
  BOOKING_CANCELLED_BY_BUSINESS
  BOOKING_REMINDER
}

enum PaymentStatus {
  PENDING
  SUCCEEDED
  FAILED
  CANCELLED
  REFUNDED // zaliczka zwrócona klientowi (#52)
  FORFEITED // zaliczka przepadła na rzecz firmy (#52)
}

enum BookingStatus {
  PENDING
  CONFIRMED
  DECLINED
  CANCELLED_BY_CLIENT
  CANCELLED_BY_BUSINESS
  COMPLETED
}

model User {
  id           String    @id @default(uuid())
  email        String    @unique
  passwordHash String
  firstName    String
  lastName     String
  phone        String?
  role         UserRole  @default(CLIENT)
  isBlocked    Boolean   @default(false)
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  business      Business?
  employee      Employee?
  bookings      Booking[]
  refreshTokens RefreshToken[]
  resetTokens   PasswordResetToken[]
}

model RefreshToken {
  id        String   @id @default(uuid())
  userId    String
  tokenHash String   @unique
  expiresAt DateTime
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model PasswordResetToken {
  id        String   @id @default(uuid())
  userId    String
  tokenHash String   @unique
  expiresAt DateTime

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Category {
  id         String     @id @default(uuid())
  name       String     @unique
  slug       String     @unique
  businesses Business[]
}

model Business {
  id          String   @id @default(uuid())
  ownerId     String   @unique
  categoryId  String
  name        String
  slug        String   @unique
  description String?
  phone       String?
  street      String
  city        String
  postalCode  String?
  lat         Float
  lng         Float
  // polityka odwołań: klient może odwołać/przenieść do X godzin przed wizytą
  cancellationHours Int     @default(24)
  isBlocked         Boolean @default(false)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  owner     User       @relation(fields: [ownerId], references: [id])
  category  Category   @relation(fields: [categoryId], references: [id])
  employees Employee[]
  services  Service[]
  bookings  Booking[]

  @@index([city])
  @@index([categoryId])
}

model Employee {
  id         String  @id @default(uuid())
  businessId String
  userId     String? @unique // pracownik może (nie musi) mieć konto w systemie
  name       String
  isActive   Boolean @default(true)

  business     Business       @relation(fields: [businessId], references: [id], onDelete: Cascade)
  user         User?          @relation(fields: [userId], references: [id])
  services     Service[]
  workingHours WorkingHours[]
  timeOffs     TimeOff[]
  bookings     Booking[]
}

model Service {
  id          String  @id @default(uuid())
  businessId  String
  name        String
  description String?
  durationMin Int
  priceCents  Int // pełna cena; na miejscu klient dopłaca ją pomniejszoną o zaliczkę
  isActive    Boolean @default(true)

  // zaliczka (#50); oba pola null = usługa płatna w całości na miejscu
  depositType  DepositType?
  depositValue Int? // FIXED → grosze, PERCENT → 1–100

  business  Business   @relation(fields: [businessId], references: [id], onDelete: Cascade)
  employees Employee[]
  bookings  Booking[]
}

model WorkingHours {
  id         String @id @default(uuid())
  employeeId String
  weekday    Int // 0 = poniedziałek … 6 = niedziela
  startTime  String // "09:00" — czas lokalny firmy
  endTime    String // "17:00"

  employee Employee @relation(fields: [employeeId], references: [id], onDelete: Cascade)

  @@index([employeeId, weekday])
}

model TimeOff {
  id         String   @id @default(uuid())
  employeeId String
  startsAt   DateTime
  endsAt     DateTime
  reason     String?

  employee Employee @relation(fields: [employeeId], references: [id], onDelete: Cascade)
}

model Booking {
  id         String        @id @default(uuid())
  clientId   String
  businessId String
  employeeId String
  serviceId  String
  startsAt   DateTime
  endsAt     DateTime
  status     BookingStatus @default(PENDING)
  clientNote String?
  reminderSentAt DateTime? // ustawiane przez cron po wysłaniu przypomnienia
  createdAt  DateTime      @default(now())
  updatedAt  DateTime      @updatedAt

  client   User     @relation(fields: [clientId], references: [id])
  business Business @relation(fields: [businessId], references: [id])
  employee Employee @relation(fields: [employeeId], references: [id])
  service  Service  @relation(fields: [serviceId], references: [id])
  payment  Payment? // Faza 2 (#50); brak = usługa bez zaliczki

  @@index([employeeId, startsAt])
  @@index([clientId])
  @@index([businessId, startsAt])
}

// Faza 2, płatności (#50): zaliczka za rezerwację, 1:1 z Booking
model Payment {
  id                    String        @id @default(uuid())
  bookingId             String        @unique
  amountCents           Int
  currency              String        @default("pln")
  status                PaymentStatus @default(PENDING)
  stripePaymentIntentId String?       @unique // idempotentny lookup w webhooku (#51)
  stripeChargeId        String? // potrzebne do refundu (#52)
  paidAt                DateTime?

  platformFeeCents    Int       @default(0) // prowizja platformy, naliczana raz przy tworzeniu (#52)
  refundedAmountCents Int? // kwota zwrotu; amountCents zostaje kwotą pobraną (#52)
  refundedAt          DateTime?
  stripeRefundId      String?   @unique // idempotentny lookup w webhooku charge.refunded (#52)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  booking Booking @relation(fields: [bookingId], references: [id], onDelete: Cascade)

  @@index([status, createdAt])
}

// Faza 2, powiadomienia in-app (#54): drugi kanał obok maila, zapisywany przy tych samych
// zdarzeniach rezerwacji i dla tego samego adresata
model Notification {
  id        String           @id @default(uuid())
  userId    String
  type      NotificationType
  title     String // treść zdenormalizowana: powiadomienie jest zamrożoną wiadomością,
  body      String // a lista dla dzwoneczka schodzi wtedy do jednego SELECT-a bez joinów
  url       String // deep-link do wizyty w apps/web
  readAt    DateTime?
  createdAt DateTime         @default(now())

  bookingId String?
  booking   Booking? @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt])
  @@index([userId, readAt]) // licznik nieprzeczytanych — endpoint odpytywany pollingiem
}
```

Uwagi:

- Wolne sloty **nie są materializowane w bazie** — wyliczane on-the-fly (sekcja 7).
- Geo: zwykłe kolumny `lat`/`lng` + Haversine w SQL; PostGIS dopiero przy tysiącach firm.
- `WorkingHours` dopuszcza wiele przedziałów na dzień (np. 9–13 i 15–19).
- Strefa czasowa: MVP zakłada `Europe/Warsaw` dla całej platformy; czasy wizyt w UTC w bazie.

---

## 5. Architektura backendu (NestJS)

Moduły w `apps/api/src/app/`:

| Moduł           | Odpowiedzialność                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------- |
| `auth`          | rejestracja, login, refresh, reset hasła; guardy JWT + role                                       |
| `users`         | profil zalogowanego użytkownika                                                                   |
| `categories`    | słownik kategorii (seed + odczyt)                                                                 |
| `businesses`    | CRUD profilu firmy, wyszukiwarka publiczna                                                        |
| `employees`     | CRUD pracowników, grafiki (`WorkingHours`), urlopy (`TimeOff`)                                    |
| `services`      | CRUD usług, przypisania pracownik↔usługa                                                          |
| `availability`  | wyliczanie wolnych slotów                                                                         |
| `bookings`      | tworzenie/akceptacja/odwoływanie rezerwacji, maszyna stanów                                       |
| `notifications` | wysyłka emaili (Nodemailer) + cron przypomnień (`@nestjs/schedule`) + powiadomienia in-app (Faza 2) |
| `payments`      | zaliczki: `PaymentIntent` przy rezerwacji, webhook Stripe, cron wygaszania nieopłaconych (Faza 2) |
| `admin`         | listy firm/użytkowników, blokowanie                                                               |
| `prisma`        | `PrismaService` (globalny)                                                                        |

### Kontrakt API (REST, prefix `/api`)

| Metoda i ścieżka                                            | Rola                 | Opis                                                                               |
| ----------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------- |
| `POST /auth/register`                                       | publiczne            | rejestracja klienta                                                                |
| `POST /auth/login`                                          | publiczne            | logowanie → access + refresh token                                                 |
| `POST /auth/refresh`                                        | publiczne            | odświeżenie access tokena                                                          |
| `POST /auth/forgot-password` / `POST /auth/reset-password`  | publiczne            | reset hasła mailem                                                                 |
| `GET /me` / `PATCH /me`                                     | zalogowany           | profil                                                                             |
| `GET /categories`                                           | publiczne            | słownik kategorii                                                                  |
| `GET /businesses`                                           | publiczne            | wyszukiwarka: `?category=&city=&q=&lat=&lng=&radiusKm=`                            |
| `GET /businesses/:slug`                                     | publiczne            | profil firmy z usługami i pracownikami                                             |
| `POST /businesses`                                          | zalogowany           | założenie firmy (klient staje się właścicielem)                                    |
| `PATCH /businesses/mine`                                    | właściciel           | edycja profilu, polityki odwołań                                                   |
| `GET/POST/PATCH/DELETE /businesses/mine/services…`          | właściciel           | CRUD usług                                                                         |
| `GET/POST/PATCH/DELETE /businesses/mine/employees…`         | właściciel           | CRUD pracowników                                                                   |
| `PUT /businesses/mine/employees/:id/working-hours`          | właściciel           | zapis całego grafiku tygodniowego                                                  |
| `GET/POST/DELETE /businesses/mine/employees/:id/time-offs…` | właściciel           | urlopy                                                                             |
| `GET /businesses/:slug/availability`                        | publiczne            | wolne sloty: `?serviceId=&employeeId=&date=`                                       |
| `POST /bookings`                                            | klient               | utworzenie rezerwacji (`PENDING`); usługa z zaliczką zwraca `payment.clientSecret` |
| `GET /bookings/mine`                                        | klient               | moje wizyty                                                                        |
| `POST /bookings/:id/cancel`                                 | klient               | odwołanie (walidacja polityki firmy)                                               |
| `GET /businesses/mine/bookings`                             | właściciel/pracownik | kalendarz: `?from=&to=&employeeId=`                                                |
| `POST /bookings/:id/confirm` / `POST /bookings/:id/decline` | właściciel           | decyzja o rezerwacji                                                               |
| `POST /bookings/:id/cancel-by-business`                     | właściciel           | odwołanie przez firmę (zawsze możliwe)                                             |
| `POST /payments/webhook`                                    | Stripe               | zdarzenia płatności; bez JWT, uwierzytelnia podpis `stripe-signature` (Faza 2)     |
| `GET /notifications`                                        | zalogowany           | powiadomienia in-app z paginacją + licznik nieprzeczytanych (Faza 2)               |
| `GET /notifications/unread-count`                           | zalogowany           | sam licznik nieprzeczytanych — endpoint odpytywany pollingiem (Faza 2)              |
| `POST /notifications/:id/read` / `POST /notifications/read-all` | zalogowany       | oznaczenie jednego / wszystkich jako przeczytane (Faza 2)                           |
| `GET /admin/businesses` / `GET /admin/users`                | admin                | listy z paginacją                                                                  |
| `POST /admin/businesses/:id/block` / `unblock`              | admin                | moderacja                                                                          |

Konwencje: DTO z walidacją `class-validator`, globalny `ValidationPipe`, guardy `JwtAuthGuard` + `RolesGuard`, błędy jako standardowe kody HTTP.

---

## 6. Architektura frontendu (Angular + Tailwind)

Standalone components, signals, lazy-loaded trasy. Struktura `apps/web/src/app/`:

```
app/
├── core/                # ApiClient (HttpClient + interceptor JWT), AuthStore (signals), guardy
├── shared/              # przyciski, formularze, kalendarz, mapa (Leaflet), pipes
├── public/              # bez logowania
│   ├── landing/         # strona główna + wyszukiwarka
│   ├── search/          # wyniki: lista + mapa
│   └── business/        # profil firmy + flow rezerwacji (usługa → pracownik → slot)
├── client/              # rola: klient — moje wizyty (nadchodzące/historia)
├── business/            # rola: właściciel/pracownik
│   ├── calendar/        # widok dzień/tydzień per pracownik, oczekujące rezerwacje
│   ├── services/        # CRUD usług
│   ├── employees/       # CRUD pracowników + grafiki + urlopy
│   └── settings/        # profil firmy, polityka odwołań
└── admin/               # listy firm/użytkowników, blokowanie
```

- **Routing + guardy:** `authGuard` (zalogowany), `roleGuard(OWNER|ADMIN)`; próba wejścia bez uprawnień → redirect na login.
- **Stan:** signals + services (bez NgRx w MVP).
- **Mapa:** Leaflet + kafelki OpenStreetMap; geokodowanie adresu firmy przez Nominatim przy zapisie profilu.
- **Rezerwacja:** wizard 3 kroków na stronie firmy; wolne sloty pobierane per dzień z `GET …/availability`.
- **i18n (#57):** własny mechanizm na sygnałach w `core/i18n/`, bez dodatkowej zależności.
  - `locale.ts` trzyma **sygnał na poziomie modułu** (a nie w serwisie), bo z języka korzystają
    też czyste funkcje wołane spoza DI (`apiErrorMessage`, `formatDateTime`, `depositError`).
    Aplikacja jest zoneless, więc odczyt tego sygnału w wyrażeniu szablonu jest jedynym
    niezawodnym wyzwalaczem ponownego renderu — dlatego `t()` jest metodą, a nie czystym pipe'em.
  - Słowniki `pl.ts` / `en.ts` są **płaskie, z kluczami kropkowanymi**; `en: Dictionary`
    (`Record<keyof typeof pl, string>`) wymusza komplet kluczy na etapie kompilacji.
  - Odmiana przez liczbę: `Intl.PluralRules` (klucze `.one`/`.few`/`.many`/`.other`).
    Daty, liczby, ceny i kolacja sortowania: `Intl.*` z cache w `core/i18n/intl.ts`.
  - Wybór zapisany w `localStorage` pod `bookit.locale`; domyślnie polski, przełączanie
    bez przeładowania strony, `<html lang>` aktualizowany przy każdej zmianie (WCAG 3.1.1).
  - **Zakres:** wyłącznie UI `apps/web`. Maile, treść powiadomień in-app i `message` z koperty
    błędu API zostają po polsku — przy EN front tłumaczy błąd po `ApiErrorCode`. Pełne
    rozwiązanie wymaga `Accept-Language` w `apps/api`.

---

## 7. Kluczowe algorytmy

### Wyliczanie wolnych slotów

Wejście: `businessId`, `serviceId`, `date`, opcjonalnie `employeeId` (brak = wszyscy wykonujący usługę).

1. Pobierz `durationMin` usługi i pracowników przypisanych do usługi (lub wskazanego).
2. Dla każdego pracownika pobierz `WorkingHours` dla dnia tygodnia `date` → lista przedziałów pracy.
3. Odejmij od przedziałów `TimeOff` nachodzące na ten dzień.
4. Pobierz rezerwacje pracownika na ten dzień w statusach `PENDING` i `CONFIRMED` (pending też blokuje slot — inaczej firma mogłaby dostać dwie kolizyjne rezerwacje).
5. Idź po przedziale krokiem **15 min**; slot `[t, t + durationMin]` jest wolny, gdy mieści się w przedziale pracy i nie nachodzi na żadną rezerwację.
6. Odfiltruj sloty w przeszłości. Zwróć listę `{ employeeId, startsAt }`.

Przy `POST /bookings` walidacja wykonywana jest ponownie w transakcji (slot mógł zniknąć między odczytem a zapisem).

### Maszyna stanów rezerwacji

```mermaid
stateDiagram-v2
    [*] --> PENDING : klient rezerwuje
    PENDING --> CONFIRMED : firma akceptuje (email do klienta)
    PENDING --> DECLINED : firma odrzuca (email do klienta)
    PENDING --> CANCELLED_BY_CLIENT : klient odwołuje
    PENDING --> CANCELLED_BY_BUSINESS : firma odwołuje (email do klienta)
    CONFIRMED --> CANCELLED_BY_CLIENT : klient odwołuje\n(jeśli > cancellationHours przed startem)
    CONFIRMED --> CANCELLED_BY_BUSINESS : firma odwołuje (email do klienta)
    CONFIRMED --> COMPLETED : cron po endsAt
    DECLINED --> [*]
    CANCELLED_BY_CLIENT --> [*]
    CANCELLED_BY_BUSINESS --> [*]
    COMPLETED --> [*]
```

### Polityka odwołań

- Klient może odwołać `PENDING` zawsze, a `CONFIRMED` tylko gdy `now < startsAt − business.cancellationHours`. Nierówność jest ostra: dokładnie `cancellationHours` przed startem odwołanie już nie przechodzi.
- Firma może odwołać zawsze (klient dostaje email) — `cancel-by-business` działa zarówno dla `PENDING`, jak i `CONFIRMED`. Dla `PENDING` firma ma więc dwa wyjścia: `decline` („nie przyjmujemy tej rezerwacji") i `cancel-by-business` („przyjęliśmy, ale odwołujemy"); różni je komunikat do klienta, nie skutek dla slotu.
- Zmiana terminu w MVP = odwołanie + nowa rezerwacja (bez osobnego flow „przełóż").

### Powiadomienia (cron)

Co 15 minut: znajdź `CONFIRMED` z `startsAt` w oknie 24–24,25 h od teraz i `reminderSentAt = null` → wyślij email, ustaw `reminderSentAt`. Drugi job: `CONFIRMED` z `endsAt < now` → `COMPLETED`.

### Kanały powiadomień (Faza 2, #54)

Zdarzenie rezerwacji rozchodzi się dwoma kanałami naraz — mailem i wpisem `Notification` — z jedną tabelą routingu (`BOOKING_EVENT_RECIPIENT`), więc adresat jest zawsze ten sam: nowa i odwołana przez klienta rezerwacja idzie do firmy, decyzje firmy i przypomnienie do klienta, `PENDING` i `COMPLETED` do nikogo. Kanały są niezależne: nieudany SMTP nie blokuje wpisu in-app i odwrotnie, a żaden z nich nie może unieważnić zapisanej już operacji na rezerwacji.

Jedyny wyjątek to `REMINDER`: cron cofa `reminderSentAt`, gdy mail nie poszedł, więc następny tick powtórzy zdarzenie — zapis in-app czeka tam na sukces maila, żeby padnięty SMTP nie wyprodukował po jednym powiadomieniu na tick.

Front nie używa websocketów: dzwoneczek odpytuje `GET /notifications/unread-count` co minutę (i przy powrocie do karty), a listę pobiera przy otwarciu panelu.

### Zaliczki a maszyna stanów (Faza 2, #51)

Rezerwacja z zaliczką nie ma osobnego stanu — powstaje jako `PENDING`, tak samo jak każda inna, więc slot blokuje się już w chwili rezerwacji. To, czy została opłacona, niesie `Payment.status`:

- `PENDING` → czeka na płatność. Firma nie może jej potwierdzić (`409`) i nie dostaje maila „nowa rezerwacja"; ten wychodzi dopiero po `payment_intent.succeeded`.
- `SUCCEEDED` → rezerwacja zachowuje się jak zwykła `PENDING`, czeka na decyzję firmy.
- `CANCELLED` → zaliczka przepadła bez opłacenia; rezerwacja jest wtedy `CANCELLED_BY_CLIENT`, ale bez maila do firmy, bo o tej rezerwacji nigdy się nie dowiedziała.

Trzeci job (co 5 minut): `Payment` w `PENDING` starszy niż 15 minut → anuluj `PaymentIntent` w Stripie, ustaw `CANCELLED`, przestaw rezerwację na `CANCELLED_BY_CLIENT`. Anulowanie w Stripie idzie **przed** zapisem, żeby zwolniony slot nie mógł zostać opłacony po fakcie.

### Zwroty i prowizja platformy (Faza 2, #52)

Polityka zwrotów jest funkcją polityki odwołań powyżej — nie ma osobnych progów ani osobnej konfiguracji:

| Zdarzenie                                         | Zaliczka   | `Payment.status` |
| ------------------------------------------------- | ---------- | ---------------- |
| Klient odwołuje **w terminie** (`now < startsAt − cancellationHours`) | pełny zwrot | `REFUNDED`       |
| Firma odwołuje (`cancel-by-business`) lub odrzuca (`decline`)         | pełny zwrot | `REFUNDED`       |
| Klient odwołuje **po terminie**                                       | przepada    | `FORFEITED`      |

Opłacona zaliczka **odblokowuje późne odwołanie**: rezerwacji bez zaliczki klient po terminie nie odwoła (`409`, jak dotąd), ale jeśli zaliczka jest w `SUCCEEDED`, odwołanie przechodzi, a zaliczka zostaje u firmy jako rekompensata za nieobsadzony termin. Wyjątek kończy się na `startsAt` — znosi limit z polityki firmy, a nie prawo do odwołania wizyty, która już trwa; inaczej klient zamieniałby odbytą wizytę w „odwołaną przez klienta", dopóki cron auto-COMPLETED jej nie domknie, a przy okazji odbierałby sobie możliwość jej ocenienia. Tę samą regułę liczy flaga `canCancel` w `GET /bookings/mine`, więc UI nigdy nie pokaże przycisku, którego API odrzuci; obok niej idzie `depositForfeitOnCancel`, żeby front mógł ostrzec przed utratą zaliczki.

O tym, czy zaliczkę zwrócić, czy tylko unieważnić `PaymentIntent`, decyduje status płatności **doczytany po zapisie** statusu rezerwacji, a nie ten sprzed. Webhook `payment_intent.succeeded` bywa szybszy niż odwołanie i wchodzi między odczyt a zapis; decyzja z nieaktualnego odczytu kończyła się odwołaniem w terminie bez zwrotu, bo anulowanie intentu odbijało się od `succeeded`, a płatność zostawała w `SUCCEEDED` poza zasięgiem crona wygaszania (ten wybiera wyłącznie `PENDING`).

Refund idzie do Stripe'a z `idempotencyKey` opartym o `Payment.id`, a zapis w bazie jest warunkowy po `status = SUCCEEDED` — ponowienie nie zwróci pieniędzy dwa razy. Kolejność jest odwrotna niż przy anulowaniu nieopłaconej zaliczki: **najpierw Stripe, potem baza**, bo wcześniejszy zapis pokazywałby „zwrócono", zanim pieniądze faktycznie wyjdą. Zwrot zrobiony ręcznie z dashboardu dogania nas webhookiem `charge.refunded`, obsługiwanym tą samą ścieżką.

Prowizja platformy (`PLATFORM_FEE_PERCENT`, domyślnie 10%) naliczana jest od kwoty zaliczki w chwili tworzenia `Payment` i zapisywana w `platformFeeCents` — kwota zostaje przypięta do wiersza, więc zmiana stawki nie rusza rozliczeń już odbytych płatności. To zapis do rozliczeń, nie `application_fee_amount` ze Stripe'a: ten wymaga Connect i konta firmy po tamtej stronie, czego model `Business` nie przewiduje. Przy zwrocie prowizja schodzi do zera (wizyta się nie odbyła, nie ma od czego jej brać); przy `FORFEITED` zostaje.

---

## 8. Środowisko deweloperskie i monorepo

### Struktura workspace'u Nx

```
apps/
├── api/       # NestJS (esbuild), tu też prisma/schema.prisma
├── web/       # Angular + Tailwind
└── web-e2e/   # Playwright
libs/
└── shared/    # (przyszłe) wspólne typy/kontrakty DTO api ↔ web — dodamy, gdy pojawi się duplikacja
```

### Komendy

```bash
npm exec nx serve api          # backend na :3000
npm exec nx serve web          # frontend na :4200 (proxy /api → :3000)
npm exec nx run-many -t test lint build
npm exec nx affected -t test   # tylko dotknięte projekty
npx prisma migrate dev         # migracje (uruchamiane z apps/api)
```

### Docker Compose (`docker-compose.yml` w root)

| Serwis     | Obraz             | Port                    | Cel                    |
| ---------- | ----------------- | ----------------------- | ---------------------- |
| `postgres` | `postgres:17`     | 5432                    | baza danych            |
| `mailpit`  | `axllent/mailpit` | 8025 (UI) / 1025 (SMTP) | podgląd maili lokalnie |

Api i web w dev uruchamiane przez `nx serve` (szybszy feedback niż kontenery); konteneryzacja api/web opisana zostanie przy fazie deploymentu.

### Zmienne środowiskowe (`apps/api/.env`)

```
DATABASE_URL=postgresql://bookit:bookit@localhost:5432/bookit
JWT_SECRET=…
JWT_REFRESH_SECRET=…
SMTP_HOST=localhost
SMTP_PORT=1025
MAIL_FROM=no-reply@bookit.local
APP_URL=http://localhost:4200
# Faza 2, płatności (#50) — opcjonalne: bez nich backend startuje, a usługi
# bez zaliczki działają normalnie
STRIPE_SECRET_KEY=…
STRIPE_PUBLISHABLE_KEY=…
# lokalnie z `stripe listen` (Stripe CLI) — Stripe nie dostarcza zdarzeń na localhost,
# a sekret CLI jest ważny tylko przez czas sesji; z dashboardu dopiero po deployu
STRIPE_WEBHOOK_SECRET=…
# prowizja platformy od zaliczki w % (#52); puste = 10, wartość spoza 0–100 zatrzymuje start
PLATFORM_FEE_PERCENT=10
```

---

## 9. Roadmapa implementacji

| Etap                   | Zakres                                                                                           | Efekt do pokazania                   |
| ---------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------ |
| 1. Fundament           | docker-compose, Prisma + migracja initial, moduł `auth`, guardy, shell frontu z logowaniem       | rejestracja i logowanie działają E2E |
| 2. Firmy               | moduł `businesses` + `categories` (seed), zakładanie i edycja profilu firmy, geokodowanie adresu | firma widoczna pod `/:slug`          |
| 3. Usługi i pracownicy | CRUD usług, pracowników, przypisania, grafiki + urlopy                                           | panel firmy kompletny bez kalendarza |
| 4. Sloty i rezerwacje  | `availability`, `bookings` z maszyną stanów, wizard rezerwacji, „moje wizyty"                    | pełny flow klient → firma            |
| 5. Kalendarz firmy     | widok dzień/tydzień, akceptacja/odrzucanie, odwołania z polityką                                 | firma pracuje na kalendarzu          |
| 6. Wyszukiwarka        | lista + filtry + mapa Leaflet + sortowanie po odległości                                         | odkrywanie firm                      |
| 7. Emaile              | Nodemailer + szablony, cron przypomnień i auto-`COMPLETED`                                       | powiadomienia działają na Mailpit    |
| 8. Admin + polish      | panel admina, blokowanie, walidacje brzegowe, seedy demo, README                                 | MVP gotowe do pokazania              |

Każdy etap kończy się działającą aplikacją (`nx run-many -t test lint build` zielone).
