# BookIt

Marketplace rezerwacji wizyt u specjalistów (fryzjer, barber, paznokcie, kosmetyczka, masaż,
groomer) — alternatywa dla Booksy. Klient znajduje firmę po kategorii, mieście, frazie lub na
mapie, widzi realne wolne terminy i rezerwuje wizytę online. Firma dostaje panel z kalendarzem,
usługami, pracownikami i grafikami.

> Projekt w budowie (MVP). Nie ma jeszcze deploymentu — wszystko uruchamia się lokalnie wg
> instrukcji poniżej. Interfejs jest wyłącznie po polsku.

## Stack

| Warstwa  | Technologie                             |
| -------- | --------------------------------------- |
| Backend  | NestJS 11, Prisma 6, PostgreSQL 17, JWT |
| Frontend | Angular 22, Tailwind CSS 4, Leaflet     |
| Monorepo | Nx 23                                   |
| Testy    | Vitest, Playwright (e2e)                |
| Lokalnie | Docker Compose (Postgres + Mailpit)     |

```
apps/
├── api/       # NestJS — tu też prisma/schema.prisma, migracje i seed
├── web/       # Angular + Tailwind
└── web-e2e/   # Playwright
```

## Wymagania

- **Node.js 24** (taka wersja stoi w CI) i npm
- **Docker** z Docker Compose — dla Postgresa i Mailpita
- git

## Uruchomienie od zera

Wszystkie komendy uruchamiaj z katalogu głównego repozytorium.

### 1. Klon i zależności

```sh
git clone https://github.com/whit33y/bookit.git
cd bookit
npm install
```

### 2. Zmienne środowiskowe

```sh
cp apps/api/.env.example apps/api/.env
```

Domyślne wartości pasują do Docker Compose poniżej — do uruchomienia lokalnie nie trzeba w
tym pliku niczego zmieniać. Opis wszystkich zmiennych: [Zmienne środowiskowe](#zmienne-środowiskowe).

### 3. Baza i poczta

```sh
docker compose up -d
```

Startuje Postgres 17 na `:5432` (baza/użytkownik/hasło `bookit`) i Mailpit — podgląd maili
wysyłanych przez aplikację na http://localhost:8025.

### 4. Migracje i dane demo

```sh
export DATABASE_URL=postgresql://bookit:bookit@localhost:5432/bookit
npm exec prisma -- migrate deploy
npm exec prisma -- db seed
```

> `DATABASE_URL` trzeba wyeksportować jawnie: Prisma CLI szuka pliku `.env` obok schematu albo
> w katalogu głównym, a plik projektu leży w `apps/api/.env`. Sam backend (`nx serve api`) czyta
> go już normalnie — Nx ładuje env projektu automatycznie.

Seed zakłada kategorie, 6 firm z usługami, pracownikami i grafikami, 21 rezerwacji we wszystkich
statusach oraz 9 recenzji odbytych wizyt, żeby świeży klon miał co pokazać. Jest idempotentny —
kolejne uruchomienie odświeża dane zamiast je duplikować.

### 5. Start aplikacji

W **dwóch osobnych terminalach** (oba procesy działają w trybie ciągłym):
## Demo data

Seed fills the database with categories, 6 businesses (services, employees, schedules),
sample bookings in every status and reviews of past visits, so a fresh clone has something
to show:

```sh
export DATABASE_URL=postgresql://bookit:bookit@localhost:5432/bookit
npx prisma migrate deploy
npx prisma db seed
```

It is idempotent — running it again refreshes the data instead of duplicating it.

### Demo accounts

Password for **all** accounts: `Haslo123!`

| Role     | E-mail                 | Lands on    |
| -------- | ---------------------- | ----------- |
| ADMIN    | `admin@bookit.pl`      | `/admin`    |
| OWNER    | `wlasciciel@bookit.pl` | `/business` |
| EMPLOYEE | `pracownik@bookit.pl`  | `/business` |
| CLIENT   | `klient@bookit.pl`     | `/client`   |

> ⚠️ Passwords are public and shared — one of the accounts is an **admin**. The seed therefore
> creates demo data only on a dev environment: with `NODE_ENV` other than `development`/`test`
> (and other than empty) it skips them. Override with `SEED_DEMO=1`. Categories always seed.

Full list of accounts, businesses and seeded bookings: [docs/users.md](docs/users.md).

## Run

```sh
npm exec nx serve api
```

```sh
npm exec nx serve web
```

### 6. Gotowe

Otwórz http://localhost:4200 i zaloguj się dowolnym [kontem demo](#konta-demo), np.
`klient@bookit.pl` / `Haslo123!`.

## Porty

| Usługa   | Adres                                              | Uwagi                                  |
| -------- | -------------------------------------------------- | -------------------------------------- |
| Frontend | http://localhost:4200                              | proxy `/api` → `:3000`                 |
| API      | http://localhost:3000/api                          | globalny prefix `/api`; zmienna `PORT` |
| Postgres | `postgresql://bookit:bookit@localhost:5432/bookit` | z Docker Compose                       |
| Mailpit  | http://localhost:8025 (UI), `:1025` (SMTP)         | aplikacja nie wysyła maili na zewnątrz |

## Konta demo

Hasło do **wszystkich** kont: `Haslo123!`

| Rola     | E-mail                 | Po zalogowaniu ląduje na |
| -------- | ---------------------- | ------------------------ |
| ADMIN    | `admin@bookit.pl`      | `/admin`                 |
| OWNER    | `wlasciciel@bookit.pl` | `/business`              |
| EMPLOYEE | `pracownik@bookit.pl`  | `/business`              |
| CLIENT   | `klient@bookit.pl`     | `/client`                |

> ⚠️ Hasła są jawne i wspólne — wśród kont jest **admin**. Dlatego seed zakłada dane demo
> wyłącznie na środowisku deweloperskim: przy `NODE_ENV` innym niż `development`/`test`
> (i innym niż puste) pomija je. Świadome wymuszenie: `SEED_DEMO=1`. Kategorie seedują się zawsze.

Pełna lista 12 kont, 6 firm i zaseedowanych rezerwacji: [docs/users.md](docs/users.md).

## Zmienne środowiskowe

Plik `apps/api/.env` (wzorzec: `apps/api/.env.example`). Poza `STRIPE_*` wszystkie są
wymagane — brak `SMTP_*` lub `MAIL_FROM` zatrzyma start backendu, brak pozostałych ujawni się
przy pierwszym żądaniu, które ich potrzebuje (logowanie, wysyłka maila).

| Zmienna              | Domyślnie (dev)                                    | Do czego                                |
| -------------------- | -------------------------------------------------- | --------------------------------------- |
| `DATABASE_URL`       | `postgresql://bookit:bookit@localhost:5432/bookit` | połączenie z Postgresem                 |
| `JWT_SECRET`         | `change-me`                                        | podpis access tokenów                   |
| `JWT_REFRESH_SECRET` | `change-me-too`                                    | podpis refresh tokenów                  |
| `SMTP_HOST`          | `localhost`                                        | serwer SMTP (lokalnie Mailpit)          |
| `SMTP_PORT`          | `1025`                                             | port SMTP                               |
| `MAIL_FROM`          | `no-reply@bookit.local`                            | nadawca maili                           |
| `APP_URL`            | `http://localhost:4200`                            | baza linków w mailach (np. reset hasła) |

Opcjonalnie `PORT` — port API, domyślnie `3000`.

### Stripe (płatności, #50)

Trzy zmienne **opcjonalne**: bez nich backend startuje normalnie, a usługi bez zaliczki działają
jak dotąd — dzięki temu lokalny setup i CI nie wymagają konta Stripe. Próba pobrania zaliczki
przy braku klucza kończy się błędem `503`, a nie wywaleniem startu jak przy `SMTP_*`.

| Zmienna                  | Skąd                                                        | Kto używa                          |
| ------------------------ | ----------------------------------------------------------- | ---------------------------------- |
| `STRIPE_SECRET_KEY`      | sandbox → Developers → API keys → _Secret key_ (`sk_test_…`) | backend, PaymentIntent i refund    |
| `STRIPE_PUBLISHABLE_KEY` | ten sam ekran, _Publishable key_ (`pk_test_…`)               | front, Payment Element (#53)       |
| `STRIPE_WEBHOOK_SECRET`  | `stripe listen` — patrz niżej, **nie** dashboard             | weryfikacja podpisu webhooka (#51) |

Sprawdzenie, że klucz testowy działa — utworzenie i anulowanie PaymentIntenta na 10 zł:

```sh
export $(grep STRIPE_SECRET_KEY apps/api/.env | xargs)
curl -s https://api.stripe.com/v1/payment_intents \
  -u "$STRIPE_SECRET_KEY:" -d amount=1000 -d currency=pln -d "payment_method_types[]=card"
curl -s -X POST https://api.stripe.com/v1/payment_intents/<id-z-odpowiedzi>/cancel \
  -u "$STRIPE_SECRET_KEY:"
```

Zaliczkę ustawia się per usługa (`depositType` + `depositValue`): `PERCENT` z wartością 1–100
liczy procent ceny, `FIXED` to kwota w groszach, nie wyższa niż cena. Oba pola puste = usługa
bez zaliczki. W danych demo zaliczkę ma „Koloryzacja" (30%) i „Masaż gorącymi kamieniami" (50 zł).

#### Webhooki lokalnie — Stripe CLI

Stripe **nie potrafi dostarczyć zdarzenia na `localhost`**, bo endpoint musi być publicznie
osiągalny. Sekret podpisu z dashboardu (Developers → Webhooks) jest więc lokalnie bezużyteczny —
przyda się dopiero przy deployu z publicznym URL-em. W developmencie tunel zestawia Stripe CLI:

```sh
brew install stripe                 # macOS; inne systemy: github.com/stripe/stripe-cli
stripe login                        # jednorazowo, otwiera przeglądarkę
stripe listen --forward-to localhost:3000/api/payments/webhook
```

`stripe listen` wypisuje na start **własny** sekret podpisu (`whsec_…`) — to jego trzeba wkleić
do `STRIPE_WEBHOOK_SECRET` w `apps/api/.env` i zrestartować backend. Sekret jest **ważny tylko
przez czas tej sesji CLI**: po `Ctrl-C` i ponownym `stripe listen` dostaniesz nowy i trzeba go
podmienić, inaczej weryfikacja podpisu zacznie odrzucać zdarzenia.

Sztuczne zdarzenie do przetestowania handlera, w drugim terminalu obok działającego `listen`:

```sh
stripe trigger payment_intent.succeeded
```

> Endpoint `/api/payments/webhook` powstaje w #51 — do tego czasu `stripe listen` zwróci 404,
> co i tak wystarcza do sprawdzenia, że tunel i logowanie CLI działają.

## Codzienna praca

```sh
npm exec nx serve api                       # backend na :3000
npm exec nx serve web                       # frontend na :4200
npm exec nx test api                        # testy jednego projektu
npm exec nx run-many -- -t test lint build  # pełny zestaw przed PR-em
npm exec nx affected -- -t test             # tylko dotknięte projekty
```

> Podwójny myślnik przed flagami jest konieczny — bez niego `npm exec` zjada argumenty po `-t`
> i Nx zgłasza `Missing required argument: targets`.

Po zmianie `apps/api/prisma/schema.prisma`:

```sh
export DATABASE_URL=postgresql://bookit:bookit@localhost:5432/bookit
npm exec prisma -- migrate dev
```

## Dokumentacja

- [docs/SDD.md](docs/SDD.md) — projekt techniczny: model danych, API, decyzje architektoniczne
- [docs/BACKLOG.md](docs/BACKLOG.md) — zakres MVP, milestone'y i kolejność issue
- [docs/users.md](docs/users.md) — dane demo: konta, firmy, rezerwacje
- [docs/design-system](docs/design-system) — zasady UI
