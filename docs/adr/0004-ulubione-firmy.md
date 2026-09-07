# Ulubione firmy: wyszukiwarka zostaje publiczna, a zmiana roli kasuje listę

Klient może oznaczyć firmę jako ulubioną i wrócić do listy spod `/client/favorites` (#169).
Dwie decyzje z tego projektu wyglądałyby w kodzie na przeoczenie, więc zapisujemy je tutaj.

## Wynik wyszukiwarki nie mówi, czy firma jest ulubiona

`GET /businesses` zostaje publiczny i bezstanowy. Serce w wynikach nakłada front: po zalogowaniu
klienta pobiera raz `GET /favorites/ids` i trzyma zbiór identyfikatorów w sygnale.

Oczywistszy wariant — opcjonalny guard JWT i pole `isFavorite` w każdym wyniku — odrzucony
z trzech powodów naraz. Takiego guarda w repo nie ma, więc trzeba by go napisać i utrzymywać.
Wyszukiwarka ma dwie ścieżki zapytania, Prismę i surowy SQL Haversine, więc join doszedłby
w dwóch miejscach. A odpowiedź publicznego endpointu przestałaby zależeć wyłącznie od parametrów
zapytania, co zamyka drogę do jakiegokolwiek cache'owania jej po drodze.

Cena: front robi drugie żądanie na start sesji i musi sam pilnować, żeby zbiór nie rozjechał się
ze stanem serwera. Lista jednego klienta to kilkanaście identyfikatorów, więc żądanie jest tanie.

## Awans z roli CLIENT kasuje ulubione

Ulubione ma wyłącznie `CLIENT`. Zmiana roli kasuje jego wiersze `FavoriteBusiness`, w tej samej
transakcji co awans — przy akceptacji zgłoszenia firmy (`admin.service.ts`) i przy przypięciu
konta jako pracownika (`employees.service.ts`).

Konsekwencja, która wygląda na błąd, a nią nie jest: rola pracownika jest odwracalna. Właściciel
odpina pracownika, konto wraca na `CLIENT` — i wraca z pustą listą ulubionych, bo wiersze zniknęły
przy przypięciu. Nie odtwarzamy ich. Wariant „wiersze zostają, tylko ich nie widać" był
rozważany i odrzucony: rola bez ulubionych ma ich nie mieć również w bazie, żeby nie utrzymywać
danych, do których nie prowadzi żadna ścieżka.
