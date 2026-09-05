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
