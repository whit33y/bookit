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
_Unikaj_: karta, widget, tile

### Rezerwacje

**Oczekująca rezerwacja**:
Rezerwacja o statusie `PENDING` — czeka na decyzję firmy (akceptacja albo odrzucenie).
Może dotyczyć terminu z przeszłości, jeśli nikt jej nie rozpatrzył.
_Unikaj_: nadchodząca rezerwacja, nowa rezerwacja

**Nadchodząca wizyta**:
Rezerwacja o statusie `CONFIRMED` lub `PENDING`, której termin dopiero nastąpi.
Porządkuje ją czas, nie status — w odróżnieniu od oczekującej rezerwacji.
_Unikaj_: oczekująca wizyta, przyszła rezerwacja
