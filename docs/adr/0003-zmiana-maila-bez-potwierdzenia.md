# Zmiana adresu e-mail wchodzi bez potwierdzenia linkiem

Klient i właściciel mogą zmienić adres e-mail własnego konta (#167). Adres jest loginem, więc
zmiana wchodzi **natychmiast** po podaniu obecnego hasła — bez linku potwierdzającego wysłanego
na nowy adres, mimo że w repo jest SMTP, są szablony i jest gotowy wzorzec tokenów
(`PasswordResetToken`). To wybór, nie przeoczenie.

Pracownik i administrator tej trasy nie mają: ich konta zakłada ktoś inny (właściciel firmy, inny
administrator), więc adres jest tam tożsamością nadaną przez organizację, a samodzielna zmiana
obchodziłaby tę kontrolę.

## Rozważane opcje

- **Link potwierdzający na nowy adres** — odrzucone. Kosztuje osobną tabelę tokenów, ich TTL
  i sprzątanie, drugi endpoint, stan pośredni („zmiana czeka na potwierdzenie") widoczny w API
  i w interfejsie, oraz decyzję, co się dzieje, gdy token wygaśnie albo gdy w międzyczasie ktoś
  zajmie nowy adres. Chroni przed jedną rzeczą — literówką — a tę tanio łapiemy inaczej.
- **Podwójne potwierdzenie: link na nowy i na stary adres** — odrzucone tym bardziej: całe
  powyższe, razy dwa, plus zmiana, która nie wchodzi, dopóki użytkownik nie ma dostępu do obu
  skrzynek naraz.
- **Zmiana natychmiast, po haśle** — wybrane.

## Dlaczego to wystarcza

Ryzyko literówki kompensują cztery rzeczy naraz:

- **hasło** — zmiana nie jest przypadkowym kliknięciem,
- **powtórzony adres w formularzu** — porównywany po normalizacji, więc różnica wielkości liter
  nie jest literówką,
- **wylogowanie** — odpowiedź nie zawiera nowej pary tokenów, a wszystkie refresh tokeny giną.
  Żeby wrócić, trzeba zobaczyć nowy adres i go wpisać, co jest nieformalną weryfikacją: literówkę
  widać od razu przy pierwszym logowaniu, a nie po tygodniu,
- **powiadomienie na stary adres** — jedyna ochrona przy przejętym koncie: dotychczasowy
  właściciel dowiaduje się, że traci login.

Link potwierdzający dokłada do tego tylko dowód, że nowa skrzynka istnieje i należy do
wpisującego. Wylogowanie daje ten sam dowód, tyle że po fakcie i za darmo.

## Konsekwencje

- Zmiana jest nieodwracalna w skutkach: po niej loguje się już tylko nowy adres. Interfejs musi
  o tym mówić wprost przed zatwierdzeniem, nie po.
- Adres wpisany z literówką odcina od konta do czasu resetu hasła przez wsparcie. Akceptujemy to
  jako koszt braku stanu pośredniego — powtórzenie adresu i wylogowanie mają to złapać wcześniej.
- Nowy adres zajęty przez inne konto kończy się `409` z jasnym komunikatem. Rejestracja i tak
  zdradza zajętość adresu, a ciche „zmieniono", po którym nie da się zalogować, byłoby gorsze niż
  to ujawnienie.
- Powiadomienie na stary adres jest krytyczne, ale nie blokujące: zapis i skasowanie sesji idą
  w jednej transakcji, a wysyłka dopiero po commicie i bez prawa wywalenia operacji, gdy SMTP
  zawiedzie. Zmiany i tak nie da się cofnąć, więc błąd maila zamieniony na `500` zostawiłby
  użytkownika z fałszywą informacją, że nic się nie stało.
- Adres normalizujemy tą samą funkcją co przy rejestracji (`normalizeEmail`). Inaczej
  „Jan@example.com" wpisany tutaj rozminąłby się z „jan@example.com" przy logowaniu.
