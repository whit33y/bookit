# Dane demo

Wszystko, co zakłada seed (`apps/api/prisma/seed.ts` + katalog `apps/api/prisma/seed/`):
konta na każdą rolę, sześć firm z pełną ofertą i grafikami, rezerwacje we wszystkich
statusach oraz recenzje odbytych wizyt. Służą wyłącznie do lokalnego developmentu
i przeglądu aplikacji.

> ⚠️ Hasła są jawne i wspólne dla wszystkich kont — wśród nich jest konto **ADMIN**.
> Dlatego seed zakłada dane demo wyłącznie na środowisku deweloperskim: przy `NODE_ENV` innym
> niż `development`/`test` (i innym niż puste) pomija je i tylko o tym informuje. Świadome
> wymuszenie: `SEED_DEMO=1`. Kategorie seedują się zawsze.

## Hasło (wszystkie konta)

```
Haslo123!
```

## Konta

| Rola         | E-mail                                            | Imię i nazwisko    | Po zalogowaniu ląduje na | Co może                                                                        |
| ------------ | ------------------------------------------------- | ------------------ | ------------------------ | ------------------------------------------------------------------------------ |
| **ADMIN**    | `admin@bookit.pl`                                 | Admin Bookit       | `/admin`                 | panel admina: listy firm i użytkowników, kolejka zgłoszeń, blokowanie firm     |
| **OWNER**    | `wlasciciel@bookit.pl`                            | Anna Kowalska      | `/business`              | panel „Studio Fryzur „Nożyczki”": usługi, pracownicy, grafik, kalendarz        |
| **OWNER**    | `wlasciciel2@bookit.pl` … `wlasciciel6@bookit.pl` | —                  | `/business`              | właściciele pozostałych pięciu firm                                            |
| **EMPLOYEE** | `pracownik@bookit.pl`                             | Marek Wiśniewski   | `/business`              | kalendarz i oczekujące rezerwacje „Nożyczek"                                   |
| **EMPLOYEE** | `barber@bookit.pl`                                | Tomasz Lewandowski | `/business`              | to samo w „Brzytwie"                                                           |
| **CLIENT**   | `klient@bookit.pl`                                | Kinga Nowak        | `/client`                | wyszukiwanie firm, rezerwacje, „Moje wizyty" (pełny przekrój statusów)         |
| **CLIENT**   | `klient2@bookit.pl`                               | Bartosz Wróbel     | `/client`                | dodatkowy klient, żeby panel firmy nie pokazywał wszędzie tego samego nazwiska |
| **CLIENT**   | `klient3@bookit.pl`                               | Zofia Duda         | `/client`                | jw.                                                                            |
| **CLIENT**   | `zgloszenie@bookit.pl`                            | Michał Zawadzki    | `/client`                | zgłosił firmę — zgłoszenie czeka na decyzję administratora (`PENDING`)         |
| **CLIENT**   | `zgloszenie2@bookit.pl`                           | Karolina Baran     | `/client`                | jego zgłoszenie zostało odrzucone (`REJECTED`) — można je wysłać ponownie      |

Razem 14 kont. Do przeglądu aplikacji wystarczą cztery pierwsze wiersze — reszta istnieje,
bo `Business.ownerId` jest `@unique` (każda firma musi mieć własnego właściciela) i żeby
rezerwacje w kalendarzu należały do różnych osób.

## Firmy

| Slug              | Nazwa                      | Kategoria   | Miasto   | Właściciel              |
| ----------------- | -------------------------- | ----------- | -------- | ----------------------- |
| `studio-nozyczki` | Studio Fryzur „Nożyczki”   | Fryzjer     | Kraków   | `wlasciciel@bookit.pl`  |
| `barber-brzytwa`  | Barber Shop „Brzytwa”      | Barber      | Warszawa | `wlasciciel2@bookit.pl` |
| `studio-lakier`   | Studio Paznokci „Lakier”   | Paznokcie   | Wrocław  | `wlasciciel3@bookit.pl` |
| `gabinet-aura`    | Gabinet Kosmetyczny „Aura” | Kosmetyczka | Gdańsk   | `wlasciciel4@bookit.pl` |
| `studio-relaks`   | Studio Masażu „Relaks”     | Masaż       | Poznań   | `wlasciciel5@bookit.pl` |
| `salon-azor`      | Salon dla psów „Azor”      | Groomer     | Katowice | `wlasciciel6@bookit.pl` |

Współrzędne są prawdziwe — wyszukiwanie po odległości i piny na mapie mają sens.
**`salon-azor` jest zablokowany** (`isBlocked = true`): panel admina ma co odblokować,
a wyszukiwarka i availability tej firmy nie pokazują. Wszystkie sześć firm ma
`status = APPROVED` — działają, bo są wpuszczone na platformę.

## Zgłoszenia firm

Dwa wiersze `Business` bez oferty i pracowników — firma powstaje w stanie `PENDING`
i nie robi nic, dopóki administrator jej nie zaakceptuje (#141). Ich autorzy zostają
`CLIENT`-ami: rola `OWNER` przychodzi dopiero z akceptacją.

| Slug                  | Nazwa                    | Miasto    | Zgłaszający              | Stan       |
| --------------------- | ------------------------ | --------- | ------------------------ | ---------- |
| `studio-brew-linia`   | Studio Brwi „Linia”      | Łódź      | `zgloszenie@bookit.pl`   | `PENDING`  |
| `studio-tatuazu-igla` | Studio Tatuażu „Igła”    | Bydgoszcz | `zgloszenie2@bookit.pl`  | `REJECTED` |

Odrzucone zgłoszenie niesie powód (`rejectionReason`) i da się je wysłać ponownie —
`POST /businesses` nadpisuje wtedy ten sam wiersz i wraca do `PENDING`. Żadne z nich nie jest
widoczne publicznie: ani w wyszukiwarce, ani pod `/:slug`, ani przy zakładaniu rezerwacji.

`PENDING`-owe „Studio Brwi «Linia»" czeka w kolejce zgłoszeń administratora
(`GET /admin/business-applications`, #143) — jest co zaakceptować albo odrzucić z powodem,
a decyzja idzie do zgłaszającego mailem i dzwoneczkiem.

Każda firma ma 2–3 aktywne usługi (30–90 min, 50–250 zł) i 1–2 pracowników z grafikiem
pn–pt, a część także w soboty (godziny różnią się między pracownikami, żeby kalendarz nie był
jednolitą kratą). Pracownicy poza `pracownik@bookit.pl` i `barber@bookit.pl` nie mają kont
w systemie — `Employee.userId` jest opcjonalne. Marek Wiśniewski ma urlop (`TimeOff`)
obejmujący dwa jego dni robocze, mniej więcej tydzień do przodu, żeby w kalendarzu było
widać zablokowane dni.

## Rezerwacje

21 rezerwacji rozłożonych na trzech klientów, co najmniej po jednej na każdy status
z `BookingStatus` (`COMPLETED` dziesięć, `PENDING` i `CONFIRMED` po cztery, pozostałe po jednej).
Terminy liczone są **względem momentu uruchomienia seeda**, w dniach roboczych pracownika:
przeszłe wizyty zawsze leżą przed „teraz", przyszłe po nim, wszystkie na siatce 15 minut
i w godzinach pracy.

Świadome decyzje:

- **Nie ma przeszłych `CONFIRMED`** — cron auto-domykania (#39) przerobiłby je na `COMPLETED`
  w kwadrans po starcie API i historia rozjechałaby się z tym opisem.
- Najbliższe `CONFIRMED` leży 2 dni robocze w przód, czyli **poza** oknem przypomnień
  (2 h – 24,25 h), więc świeży seed nie wysyła od razu maila. Chcąc zobaczyć przypomnienie
  w Mailpicie, wystarczy przestawić termin wizyty w aplikacji.

## Recenzje

9 recenzji, każda podpięta do wizyty `COMPLETED` (jedna recenzja na rezerwację — pilnuje tego
`Review.bookingId @unique`). Oceny celowo nie są jednakowe, żeby dało się zobaczyć realne średnie:

| Firma                      | Recenzje | Średnia |
| -------------------------- | -------- | ------- |
| Studio Fryzur „Nożyczki”   | 3        | 4,67    |
| Barber Shop „Brzytwa”      | 2        | 4,50    |
| Studio Paznokci „Lakier”   | 3        | 3,67    |
| Studio Masażu „Relaks”     | 1        | 5,00    |
| Gabinet Kosmetyczny „Aura” | 0        | —       |

Świadome decyzje:

- **Wizyta Kingi w „Relaksie" nie ma recenzji** — to jedyna wizyta `COMPLETED` głównego konta
  klienta bez oceny, więc w „Moich wizytach" zawsze jest na czym przeklikać „oceń wizytę".
- **„Aura" nie ma ani jednej recenzji** — profil firmy bez ocen ma pokazywać brak ocen,
  a nie atrapę „0.0".
- Część recenzji jest **bez komentarza** (sama ocena) i jest wśród nich ocena `2` — UI musi
  radzić sobie z jednym i z drugim.
- Recenzje znikają razem z rezerwacjami (`onDelete: Cascade`), więc seed nie czyści ich osobno.

## Jak uruchomić seed

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

## Idempotencja

Kolejne uruchomienia aktualizują istniejące rekordy zamiast tworzyć duplikaty — kluczami są
`User.email`, `Business.ownerId`, `Employee.userId` (a dla pracowników bez konta i dla usług:
nazwa w obrębie firmy). Ponowne odpalenie przywraca też hasła do wartości z tego pliku, gdyby
ktoś zmienił je w aplikacji.

Wyjątkiem są **grafiki, urlopy i rezerwacje**: nie mają klucza naturalnego, a rezerwacje są
dodatkowo liczone względem „teraz", więc seed kasuje je i zapisuje od nowa. Dotyczy to
wyłącznie firm demo — jeśli klikałeś w nich własne rezerwacje do testów, kolejny seed je
usunie (wypisuje w logu, ile). Razem z rezerwacjami znikają **recenzje** — kaskadowo, przez
klucz obcy, więc dotyczy to także recenzji wystawionych ręcznie w aplikacji.

## Struktura

| Plik                                    | Rola                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| `apps/api/prisma/seed.ts`               | entry point: kategorie → bramka `NODE_ENV`/`SEED_DEMO` → dane demo             |
| `apps/api/prisma/seed/demo-data.ts`     | deklaratywny opis danych (konta, firmy, usługi, grafiki, rezerwacje, recenzje) |
| `apps/api/prisma/seed/demo-bookings.ts` | przeliczanie terminów względem „teraz" na instanty UTC                         |
| `apps/api/prisma/seed/seed-demo.ts`     | zapis do bazy (idempotentne upserty)                                           |
