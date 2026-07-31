# Konta demo

Konta zakładane przez seed (`apps/api/prisma/seed.ts`) — po jednym na każdą rolę z `UserRole`.
Służą wyłącznie do lokalnego developmentu i przeglądu aplikacji.

> ⚠️ Hasła są jawne i wspólne dla wszystkich kont — wśród nich jest konto **ADMIN**.
> Dlatego seed zakłada je wyłącznie na środowisku deweloperskim: przy `NODE_ENV` innym niż
> `development`/`test` (i innym niż puste) pomija je i tylko o tym informuje. Świadome
> wymuszenie: `SEED_DEMO=1`. Kategorie seedują się zawsze.

## Hasło (wszystkie konta)

```
Haslo123!
```

## Konta

| Rola | E-mail | Po zalogowaniu ląduje na | Co może |
|---|---|---|---|
| **ADMIN** | `admin@bookit.pl` | `/admin` | panel admina: listy firm i użytkowników, blokowanie firm |
| **CLIENT** | `klient@bookit.pl` | `/client` | wyszukiwanie firm, rezerwacje, „Moje wizyty" |
| **OWNER** | `wlasciciel@bookit.pl` | `/business` | panel firmy „Studio Fryzur „Nożyczki"": usługi, pracownicy, grafik, kalendarz |
| **EMPLOYEE** | `pracownik@bookit.pl` | `/business` | kalendarz i lista oczekujących rezerwacji swojej firmy |

## Dane towarzyszące

Żeby role OWNER i EMPLOYEE miały co pokazywać, seed zakłada też komplet danych firmy:

- **Firma** „Studio Fryzur „Nożyczki"" (slug `studio-nozyczki`, Kraków, ul. Józefa 12,
  kategoria *Fryzjer*) — właścicielem jest `wlasciciel@bookit.pl`
- **Pracownik** Marek Wiśniewski powiązany z kontem `pracownik@bookit.pl`
- **Usługa** „Strzyżenie męskie" (30 min, 70 zł) przypisana do tego pracownika
- **Grafik** pracownika: poniedziałek–piątek, 9:00–17:00

## Jak założyć konta

```bash
docker compose up -d                      # postgres + mailpit
cp apps/api/.env.example apps/api/.env    # jeśli jeszcze nie masz

export DATABASE_URL=postgresql://bookit:bookit@localhost:5432/bookit
npm exec prisma -- migrate deploy
npm exec prisma -- db seed
```

Seed jest podpięty pod `package.json#prisma.seed`, więc uruchamia go `prisma db seed`
(nie `npm run seed` — w `scripts` nie ma takiego wpisu).

`DATABASE_URL` trzeba podać jawnie: Prisma CLI szuka `.env` obok schematu
(`apps/api/prisma/`) albo w katalogu głównym, a plik projektu leży w `apps/api/.env`.
Sam backend (`npm exec nx serve api`) czyta go już normalnie przez `@nestjs/config`.

Seed jest **idempotentny** — kolejne uruchomienia aktualizują istniejące rekordy
(po `email`, `slug` i `userId`) zamiast tworzyć duplikaty. Ponowne odpalenie przywraca też
hasła do wartości z tego pliku, gdyby ktoś zmienił je w aplikacji.
