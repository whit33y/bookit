# bookit

Platforma rezerwacji wizyt: klient znajduje firmę i rezerwuje termin u konkretnego pracownika,
firma zarządza ofertą, grafikami i rezerwacjami z własnego panelu.

## Język

### Panel firmy

**Panel firmy**:
Cały obszar aplikacji dostępny dla ról OWNER i EMPLOYEE, pod ścieżką `/business/**`.
_Unikaj_: panel administracyjny (to obszar roli ADMIN, `/admin/**`)

**Pulpit firmy**:
Strona główna panelu firmy (`/business`) — zbiór kafelków z podglądem danych, przez które
wchodzi się na podstrony.
_Unikaj_: dashboard, strona główna panelu

**Kafelek**:
Pojedynczy blok pulpitu: tytuł, podgląd danych swojej podstrony i wejście na nią.
Cały kafelek jest jednym linkiem — nie zawiera akcji ani zagnieżdżonych odnośników.
Jedyny wyjątek to ponowienie nieudanego pobrania: to naprawa żądania, nie decyzja firmy
(decyzje zapadają na podstronach).
_Unikaj_: karta, widget, tile

**Agenda**:
Lista najbliższych nadchodzących wizyt w kafelku kalendarza, licząc od teraz, a nie od
początku dnia. Mówi, co dalej — także z kolejnych dni, gdy dziś nic już nie zostało.
Nagłówek kafelka liczy osobno cały dzisiejszy dzień, więc agenda i ta liczba nie muszą
się zgadzać.
_Unikaj_: plan dnia, harmonogram, lista wizyt

**Ostrzeżenie kafelka**:
Podgląd kafelka zastąpiony komunikatem z zachętą, gdy zero znaczy „firma nie działa": brak
aktywnych usług albo aktywnych pracowników — bez usług klient nie ma czego zarezerwować,
bez pracowników nie ma u kogo. Odróżnia się od stanu pustego, który mówi tylko „na razie nic
tu nie ma" (brak wizyt na dziś, brak oczekujących rezerwacji).
_Unikaj_: błąd, alert, stan pusty

### Rezerwacje

**Oczekująca rezerwacja**:
Rezerwacja o statusie `PENDING` — czeka na decyzję firmy (akceptacja albo odrzucenie).
Może dotyczyć terminu z przeszłości, jeśli nikt jej nie rozpatrzył.
_Unikaj_: nadchodząca rezerwacja, nowa rezerwacja

**Nadchodząca wizyta**:
Rezerwacja o statusie `CONFIRMED` lub `PENDING`, której termin dopiero nastąpi.
Porządkuje ją czas, nie status — w odróżnieniu od oczekującej rezerwacji.
_Unikaj_: oczekująca wizyta, przyszła rezerwacja

### Zgłoszenia firm

**Zgłoszenie firmy**:
Firma w stanie `PENDING` — czeka na decyzję administratora i nie działa: nie ma jej
w wyszukiwarce ani w profilach, nie da się w niej rezerwować, a zgłaszający pozostaje
klientem, dopóki administrator nie zaakceptuje. Jeden użytkownik ma najwyżej jedno
zgłoszenie, a po akceptacji ten sam rekord jest już działającą firmą.
_Unikaj_: wniosek, firma oczekująca, nowa firma

**Kolejka zgłoszeń**:
Lista zgłoszeń czekających na decyzję administratora — praca do wykonania, która ma się
wyzerować. Odróżnia się od rejestru firm, który pokazuje firmy działające i służy
przeglądaniu, nie decydowaniu.
_Unikaj_: lista firm, moderacja

**Odrzucenie zgłoszenia**:
Decyzja administratora o niewpuszczeniu firmy na platformę, zawsze z powodem. Zgłaszający
może wypełnić formularz od nowa — odrzucenie nie zamyka drogi. Odróżnia się od blokady
firmy, która dotyczy firmy już działającej.
_Unikaj_: blokada, zawieszenie

**Firma działająca**:
Firma widoczna i rezerwowalna publicznie: zaakceptowane zgłoszenie (`APPROVED`) bez blokady
(`isBlocked = false`). Oba warunki naraz — to jeden predykat, którym filtrują wszystkie
ścieżki publiczne: wyszukiwarka, profil po slugu, dostępność terminów, recenzje i zakładanie
rezerwacji.
_Unikaj_: firma aktywna, firma publiczna, firma widoczna

**Blokada firmy**:
Kara nałożona na firmę już działającą (`isBlocked`): znika z wyszukiwarki i profilu,
nie przyjmuje nowych rezerwacji, ale zachowuje rezerwacje już złożone i rolę właściciela.
Niezależna od stanu zgłoszenia — to dwie osie, wpuszczenie i kara.
_Unikaj_: odrzucenie, dezaktywacja
