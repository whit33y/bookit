# Punkt startowy ponownej rezerwacji liczy front, nie API

Ponowna rezerwacja podpowiada klientowi pierwszy wolny termin, licząc od momentu, w którym
prawdopodobnie znów zechce przyjść (#170). Reguła tego momentu — miesiąc po wizycie zakończonej,
tydzień po odwołanej, a przy odwołaniu terminu, który jeszcze nie minął, od zaraz — mieszka
w komponencie listy „Moje wizyty". Lista wylicza datę i podaje ją kreatorowi w query paramie
`rebookFrom`, a kreator pyta API tylko o pierwsze wolne terminy w oknie 30 dni od tej daty.

Reguła biznesowa w komponencie wygląda na przeoczenie, więc zapisujemy, dlaczego tam jest.

## Rozważana alternatywa

Wariant `?rebook=<bookingId>`: kreator dostaje identyfikator minionej wizyty, pobiera ją z API
i sam odczytuje usługę, pracownika, status i termin. Reguła offsetów siedzi wtedy w serwisie
i da się ją pokryć testem API.

Odrzucony, bo kreator rezerwacji świadomie nie wymaga logowania (`app.routes.ts`) — klient
wypełnia go do końca i loguje się dopiero przy wysłaniu. Odczyt cudzej-nie-cudzej wizyty wymaga
tokenu, więc na tej jednej ścieżce prefill przestałby działać bez sesji. Do tego potrzebny byłby
nowy endpoint „daj mi tę jedną moją wizytę", którego dziś nie ma — jest tylko `GET /bookings/mine`
zwracające wszystkie.

## Konsekwencja

Offsetów nie sprawdzi test API, tylko test frontu. Uznaliśmy to za akceptowalne, bo to reguła
podpowiedzi, nie reguła rezerwacji: pomyłka daje klientowi gorszy domyślny termin, który zmienia
jednym kliknięciem, a nie zły zapis w bazie. Warunki, na których przycisk w ogóle się pokazuje
(usługa aktywna, firma publiczna, pracownik nadal przypisany do usługi), zostają po stronie API
jako `canRebook` i `rebookEmployeeId` — tych front sprawdzić nie może bez pobierania pracowników
każdej usługi z każdej minionej wizyty.
