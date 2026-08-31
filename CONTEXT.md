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

### Rezerwacje

**Oczekująca rezerwacja**:
Rezerwacja o statusie `PENDING` — czeka na decyzję firmy (akceptacja albo odrzucenie).
Może dotyczyć terminu z przeszłości, jeśli nikt jej nie rozpatrzył.
_Unikaj_: nadchodząca rezerwacja, nowa rezerwacja

**Nadchodząca wizyta**:
Rezerwacja o statusie `CONFIRMED` lub `PENDING`, której termin dopiero nastąpi.
Porządkuje ją czas, nie status — w odróżnieniu od oczekującej rezerwacji.
_Unikaj_: oczekująca wizyta, przyszła rezerwacja
