# Publiczna recenzja niesie id autora

Recenzje na profilu firmy pokazują zdjęcie profilowe autora (#165), a bajty zdjęcia wiszą pod
publicznym `GET /users/:id/avatar` (ADR-0001). Żeby front miał czym ten adres złożyć, publiczna
odpowiedź `GET /businesses/:slug/reviews` niesie `id` autora — mimo że dotąd świadomie nie
wychodziło z niej nic, po czym dałoby się rozpoznać konkretne konto poza podpisem „Anna K.".

## Rozważane opcje

- **Adres po slugu recenzji** (`/reviews/:id/avatar`) — odrzucone: to samo zdjęcie dostałoby tyle
  adresów, ile autor ma recenzji, więc `Cache-Control: immutable` przestałby cokolwiek dawać,
  a każda recenzja pobierałaby te same bajty od nowa.
- **Osobny, nieodwracalny identyfikator zdjęcia** — odrzucone: to `id` w przebraniu. Kosztuje
  kolumnę i drugą ścieżkę serwowania, a chroni tylko przed zgadywaniem, którego i tak nie ma.
- **Zdjęcia tylko dla zalogowanych** — odrzucone: recenzje czyta przede wszystkim ktoś, kto
  dopiero wybiera firmę i nie ma konta. Zalogowany i niezalogowany mają widzieć to samo.
- **`id` autora w odpowiedzi** — wybrane.

## Konsekwencje

- Publikujemy uuid, nie licznik: nie da się go zgadnąć ani policzyć z niego, ilu jest
  użytkowników. Wiedza, którą daje, kończy się na tym, co i tak widać obok — że ta osoba
  wystawiła tę recenzję.
- `id` jedzie w polu `author`, razem z podpisem i wersją zdjęcia. Recenzja nadal nie publikuje
  `clientId`: to ta sama wartość, ale w polu, które wyglądałoby na klucz do rezerwacji.
- Nazwisko autora się przez to nie zmienia — z serwisu wychodzi sam inicjał (`maskAuthor`), a `id`
  nie daje jak go odzyskać: publiczne trasy nie oddają profilu po `id`.
- Zdjęcie profilowe staje się treścią publiczną, nie tylko ozdobą własnego menu. Mówi o tym
  wprost opis sekcji w ustawieniach konta — użytkownik ma wiedzieć, gdzie ląduje obraz,
  który wgrywa.
