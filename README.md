# Kalkulator obligacji skarbowych

Kalkulator w jednym pliku HTML. Porównuje wszystkie detaliczne obligacje skarbowe (OTS, ROR, DOR, TOS, COI, ROS, EDO, ROD) na wybranym horyzoncie. Wyniki są po podatku Belki i opłatach. Kalkulator liczy też limit na obligacje rodzinne z 800+.

## Użycie

- **`odswiez.bat`**: pobiera aktualną ofertę z obligacjeskarbowe.pl i otwiera kalkulator.
- Albo ręcznie: `python fetch_bonds.py`, potem otwórz `index.html`. Jeśli strona jest już otwarta, kliknij „Odśwież dane”.

Oferta zmienia się 1. dnia każdego miesiąca. Kalkulator pokaże ostrzeżenie, gdy dane wygasną.
Bez `data.js` kalkulator działa na danych wbudowanych (oferta z 11.2026).

Parametry można podać w adresie, np.:
`index.html#kwota=50000&lata=12&inflacja=4&dziecko=2018-05&obligacja=ROD`

## Wersja opublikowana

https://claude.ai/artifact/PtQbwg9aGuDVmAi2SUMSvK (prywatny artefakt na claude.ai, udostępniany przez menu Share)

Opublikowana strona zawiera dane z dnia publikacji. Aktualizacja po zmianie oferty:
`python fetch_bonds.py`, potem `python build_artifact.py`, potem ponowna publikacja `dist/kalkulator.html` pod tym samym linkiem.

## Automatyczna aktualizacja (GitHub Actions)

Workflow `.github/workflows/update-data.yml` codziennie o 05:00 UTC uruchamia `fetch_bonds.py`.
Jeśli oferta się zmieniła (nowe serie, oprocentowanie, marże, opłaty), commituje nowe
`data.json`, `data.js` i `dist/kalkulator.html`. Gdy pobieranie się nie uda, workflow kończy się
błędem i GitHub wysyła maila. Ręczne uruchomienie: zakładka **Actions**, potem **Aktualizacja oferty obligacji**, potem **Run workflow**.

Po aktualizacji: `git pull`, żeby mieć świeże dane lokalnie.

## Pliki

| Plik | Rola |
|---|---|
| `index.html` | interfejs |
| `engine.js` | silnik obliczeń (działa też w Node) |
| `fetch_bonds.py` | scraper obligacjeskarbowe.pl, który zapisuje `data.json` i `data.js` |
| `build_artifact.py` | buduje jednoplikową wersję do publikacji: `dist/kalkulator.html` |

Strona obligacjeskarbowe.pl nie pozwala na pobieranie danych z przeglądarki (brak CORS), dlatego dane pobiera skrypt.

## Założenia modelu

- Inflacja i stopa NBP są stałe przez cały horyzont (ustawia je użytkownik).
- Po wykupie środki trafiają w zamianę na tę samą obligację, na warunkach dzisiejszej oferty.
- Jeśli horyzont kończy się przed terminem wykupu, liczony jest przedterminowy wykup z opłatą według zasad ze strony. W ROR, DOR i COI od 2. okresu opłata jest pobierana także z kapitału.
- Limit ROS/ROD to suma świadczeń: 500 zł od 04.2016, 800 zł od 01.2024, do miesiąca przed 18. urodzinami, minus kwota już wykorzystana.
- Kalkulator jest symulacją, a nie rekomendacją inwestycyjną.
