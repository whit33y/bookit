# Obrazy firm trzymamy w Postgresie, nie w object storage

Firma może mieć logo i okładkę profilu, a projekt nie ma jeszcze celu wdrożenia ani konta
w chmurze. Zamiast dysku lokalnego API zapisujemy bajty w Postgresie (tabela `BusinessImage`),
bo na typowym PaaS system plików jest efemeryczny — po redeployu katalog z uploadami znika,
a blob w bazie przeżywa deploy i wchodzi do tego samego backupu co reszta danych.

## Rozważane opcje

- **Dysk lokalny API** (`uploads/` serwowane statycznie) — odrzucone: efemeryczny FS na PaaS
  oznacza utratę wszystkich obrazów przy każdym wdrożeniu.
- **Object storage / CDN** (S3, R2, Cloudinary) — właściwy cel docelowy, ale wymaga konta,
  sekretów i konfiguracji środowisk, których projekt dziś nie ma.
- **Blob w Postgresie** — wybrane.

## Konsekwencje

- Obrazy idą przez Nest i połączenie do bazy zamiast przez CDN. Rekompensujemy to normalizacją
  do WebP (logo 512×512, okładka 1600×400 — realnie 20–200 kB) oraz `ETag` i
  `Cache-Control: immutable` na publicznym GET-cie, z wersją treści w query stringu.
- Bajty stoją w osobnej tabeli, nigdy w `Business` — inaczej pierwsze `findMany` bez `select`
  zaciągnęłoby megabajty. `Business` niesie tylko `logoVersion`/`coverVersion`: nullowalny hash
  treści, który jednocześnie odpowiada na „czy obraz istnieje" i służy za cache-buster.
- Dumpy bazy rosną o rozmiar obrazów. Przy skali platformy to kilkaset MB — akceptowalne.
- Migracja do object storage pozostaje możliwa: publiczny URL obrazka nie zmienia kształtu,
  zmienia się tylko źródło bajtów za nim.

## Dopisek (#163): zdjęcia profilowe

Ta sama decyzja obejmuje **zdjęcie profilowe** użytkownika: bajty idą do Postgresa (tabela
`UserImage`), a `User` niesie tylko `avatarVersion` — nullowalny hash treści, dokładnie w tej
samej roli, co `logoVersion` przy firmie. Powody się nie zmieniają, więc nie ma tu osobnego ADR;
zmienia się tylko właściciel obrazu.

Różnice wobec wizerunku firmy są dwie i obie wynikają z modelu, nie z decyzji o przechowywaniu:

- osoba ma **jeden** slot, nie dwa — stąd `@unique` na `userId` zamiast pary `(businessId, kind)`
  i brak kolumny `kind`;
- kadr jest zawsze kwadratem 512×512, bo zdjęcie pokazuje się przy nazwisku, nigdy jako pas.

Reguły wejścia (JPEG/PNG/WebP po sygnaturze, 5 MB, konwersja do WebP q80) są wspólne dla obu
zastosowań i mieszkają w jednym module — `common/images/image-upload`.
