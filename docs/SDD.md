# Solution Design Document — BookIt

Platforma rezerwacji wizyt u specjalistów (fryzjer, barber, paznokcie, fizjoterapeuta, groomer…) — alternatywa dla Booksy.

| | |
|---|---|
| Status | Draft — żywy dokument |
| Data | 2026-07-17 |
| Stack | NestJS + PostgreSQL + Prisma · Angular + Tailwind CSS · monorepo Nx |

---

## 1. Wizja i cele

**Problem:** klienci umawiają wizyty telefonicznie albo przez media społecznościowe — bez podglądu wolnych terminów, bez potwierdzeń, z ryzykiem pomyłek. Małe firmy usługowe nie mają taniego narzędzia do zarządzania kalendarzem i pozyskiwania klientów.

**Rozwiązanie:** marketplace, na którym klient znajduje firmę (po kategorii, mieście, frazie lub na mapie), widzi realne wolne terminy i rezerwuje wizytę online. Firma dostaje panel z kalendarzem, zarządzaniem usługami, pracownikami i grafikami.

**Charakter projektu:** side project z ambicjami komercyjnymi — MVP okrojone, ale architektura nie może zamykać drogi do rozwoju (płatności, recenzje, skala).

### Personas i role

| Rola | Kim jest | Co robi w systemie |
|---|---|---|
| **Klient** | Osoba szukająca usługi | Wyszukuje firmy, przegląda profile i cenniki, rezerwuje/odwołuje wizyty, widzi historię |
| **Właściciel** | Prowadzi firmę usługową | Zakłada profil firmy, zarządza usługami, pracownikami i grafikami, akceptuje rezerwacje, ustawia politykę odwołań |
| **Pracownik** | Specjalista zatrudniony w firmie | Widzi swój kalendarz i rezerwacje przypisane do siebie |
| **Admin** | Operator platformy | Przegląda firmy i użytkowników, blokuje naruszające zasady |

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
- Interfejs wyłącznie po polsku
- Uruchamianie przez Docker Compose (Postgres + Mailpit) lokalnie

### Faza 2 (świadomie poza MVP)

- Recenzje i oceny firm (po odbytej wizycie)
- Płatności online / zaliczki (Stripe), prowizje platformy
- Powiadomienia in-app i SMS
- Statystyki/dashboard dla firm
- i18n (angielski)
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

enum PaymentStatus {
  PENDING
  SUCCEEDED
  FAILED
  CANCELLED
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
  createdAt             DateTime      @default(now())
  updatedAt             DateTime      @updatedAt

  booking Booking @relation(fields: [bookingId], references: [id], onDelete: Cascade)

  @@index([status, createdAt])
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

| Moduł | Odpowiedzialność |
|---|---|
| `auth` | rejestracja, login, refresh, reset hasła; guardy JWT + role |
| `users` | profil zalogowanego użytkownika |
| `categories` | słownik kategorii (seed + odczyt) |
| `businesses` | CRUD profilu firmy, wyszukiwarka publiczna |
| `employees` | CRUD pracowników, grafiki (`WorkingHours`), urlopy (`TimeOff`) |
| `services` | CRUD usług, przypisania pracownik↔usługa |
| `availability` | wyliczanie wolnych slotów |
| `bookings` | tworzenie/akceptacja/odwoływanie rezerwacji, maszyna stanów |
| `notifications` | wysyłka emaili (Nodemailer) + cron przypomnień (`@nestjs/schedule`) |
| `admin` | listy firm/użytkowników, blokowanie |
| `prisma` | `PrismaService` (globalny) |

### Kontrakt API (REST, prefix `/api`)

| Metoda i ścieżka | Rola | Opis |
|---|---|---|
| `POST /auth/register` | publiczne | rejestracja klienta |
| `POST /auth/login` | publiczne | logowanie → access + refresh token |
| `POST /auth/refresh` | publiczne | odświeżenie access tokena |
| `POST /auth/forgot-password` / `POST /auth/reset-password` | publiczne | reset hasła mailem |
| `GET /me` / `PATCH /me` | zalogowany | profil |
| `GET /categories` | publiczne | słownik kategorii |
| `GET /businesses` | publiczne | wyszukiwarka: `?category=&city=&q=&lat=&lng=&radiusKm=` |
| `GET /businesses/:slug` | publiczne | profil firmy z usługami i pracownikami |
| `POST /businesses` | zalogowany | założenie firmy (klient staje się właścicielem) |
| `PATCH /businesses/mine` | właściciel | edycja profilu, polityki odwołań |
| `GET/POST/PATCH/DELETE /businesses/mine/services…` | właściciel | CRUD usług |
| `GET/POST/PATCH/DELETE /businesses/mine/employees…` | właściciel | CRUD pracowników |
| `PUT /businesses/mine/employees/:id/working-hours` | właściciel | zapis całego grafiku tygodniowego |
| `GET/POST/DELETE /businesses/mine/employees/:id/time-offs…` | właściciel | urlopy |
| `GET /businesses/:slug/availability` | publiczne | wolne sloty: `?serviceId=&employeeId=&date=` |
| `POST /bookings` | klient | utworzenie rezerwacji (`PENDING`) |
| `GET /bookings/mine` | klient | moje wizyty |
| `POST /bookings/:id/cancel` | klient | odwołanie (walidacja polityki firmy) |
| `GET /businesses/mine/bookings` | właściciel/pracownik | kalendarz: `?from=&to=&employeeId=` |
| `POST /bookings/:id/confirm` / `POST /bookings/:id/decline` | właściciel | decyzja o rezerwacji |
| `POST /bookings/:id/cancel-by-business` | właściciel | odwołanie przez firmę (zawsze możliwe) |
| `GET /admin/businesses` / `GET /admin/users` | admin | listy z paginacją |
| `POST /admin/businesses/:id/block` / `unblock` | admin | moderacja |

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

| Serwis | Obraz | Port | Cel |
|---|---|---|---|
| `postgres` | `postgres:17` | 5432 | baza danych |
| `mailpit` | `axllent/mailpit` | 8025 (UI) / 1025 (SMTP) | podgląd maili lokalnie |

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
```

---

## 9. Roadmapa implementacji

| Etap | Zakres | Efekt do pokazania |
|---|---|---|
| 1. Fundament | docker-compose, Prisma + migracja initial, moduł `auth`, guardy, shell frontu z logowaniem | rejestracja i logowanie działają E2E |
| 2. Firmy | moduł `businesses` + `categories` (seed), zakładanie i edycja profilu firmy, geokodowanie adresu | firma widoczna pod `/:slug` |
| 3. Usługi i pracownicy | CRUD usług, pracowników, przypisania, grafiki + urlopy | panel firmy kompletny bez kalendarza |
| 4. Sloty i rezerwacje | `availability`, `bookings` z maszyną stanów, wizard rezerwacji, „moje wizyty" | pełny flow klient → firma |
| 5. Kalendarz firmy | widok dzień/tydzień, akceptacja/odrzucanie, odwołania z polityką | firma pracuje na kalendarzu |
| 6. Wyszukiwarka | lista + filtry + mapa Leaflet + sortowanie po odległości | odkrywanie firm |
| 7. Emaile | Nodemailer + szablony, cron przypomnień i auto-`COMPLETED` | powiadomienia działają na Mailpit |
| 8. Admin + polish | panel admina, blokowanie, walidacje brzegowe, seedy demo, README | MVP gotowe do pokazania |

Każdy etap kończy się działającą aplikacją (`nx run-many -t test lint build` zielone).
