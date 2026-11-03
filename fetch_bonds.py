#!/usr/bin/env python3
"""Pobiera aktualną ofertę obligacji skarbowych z obligacjeskarbowe.pl.

Zapisuje:
  data.json  - dane w formacie JSON
  data.js    - te same dane jako `window.BOND_DATA = {...}` (działa przy otwarciu
               index.html bezpośrednio z dysku, gdzie fetch() jest blokowany)

Użycie:  python fetch_bonds.py
Bez zewnętrznych zależności (tylko biblioteka standardowa).
"""
from __future__ import annotations

import datetime as dt
import html
import json
import re
import sys
import urllib.request
from pathlib import Path

BASE = "https://www.obligacjeskarbowe.pl"
HERE = Path(__file__).resolve().parent
UA = "Mozilla/5.0 (compatible; kalkulator-obligacji/1.0)"

# Domyślne opłaty za przedterminowy wykup (zł / obligacja) - używane, gdy nie uda się
# ich odczytać ze strony. Stawki dla emisji od 1.09.2024 (obligacjeskarbowe.pl, 11.2026).
# Strony podają dwie stawki (stara i nowa) - parser bierze ostatnią, czyli aktualną.
DEFAULT_FEES = {"OTS": 0.0, "ROR": 0.50, "DOR": 0.70, "TOS": 1.00,
                "COI": 2.00, "ROS": 2.00, "EDO": 3.00, "ROD": 3.00}

ORDER = ["OTS", "ROR", "DOR", "TOS", "COI", "ROS", "EDO", "ROD"]


def get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", errors="replace")


def to_text(page: str) -> str:
    page = re.sub(r"<script.*?</script>|<style.*?</style>", " ", page, flags=re.S | re.I)
    txt = html.unescape(re.sub(r"<[^>]+>", " ", page))
    return re.sub(r"\s+", " ", txt)


def num(s: str | None) -> float | None:
    return None if s is None else float(s.replace(",", ".").replace(" ", ""))


def find(pattern: str, txt: str, group: int = 1, last: bool = False) -> str | None:
    found = list(re.finditer(pattern, txt, flags=re.I))
    if not found:
        return None
    return (found[-1] if last else found[0]).group(group)


def iso(d: str | None) -> str | None:
    if not d:
        return None
    day, month, year = d.split(".")
    return f"{year}-{month}-{day}"


def parse_bond(code: str, url: str, txt: str) -> dict:
    series = find(r"Seria:\s*([A-Z]{3}\d{4})", txt)
    first_rate = num(find(r"Oprocentowanie:\s*(\d+,\d+)\s*%", txt))
    margin = num(find(r"NBP\s*\+\s*(\d+,\d+)\s*%", txt) or find(r"marża\s*(\d+,\d+)\s*%", txt))
    price = num(find(r"Cena sprzedaży jednej obligacji:\s*(\d+,\d+)", txt))
    swap = num(find(r"Cena zamiany jednej obligacji:\s*(\d+,\d+)", txt))
    sale = re.search(r"Sprzedaż:\s*(\d\d\.\d\d\.\d{4})\s*-\s*(\d\d\.\d\d\.\d{4})", txt)
    period = re.search(r"Okres oprocentowania:\s*(\d\d\.\d\d\.\d{4})\s*-\s*(\d\d\.\d\d\.\d{4})", txt)
    fee = num(find(r"opłata wynosi\s*(\d+,\d+)\s*zł", txt, last=True)
              or find(r"opłatę za przedterminowy wykup w wysokości\s*(\d+,\d+)\s*zł", txt))

    if code == "OTS":
        fee = 0.0  # OTS: wcześniejszy wykup bez opłat, ale i bez odsetek
    if margin is None and code in ("TOS", "OTS"):
        margin = 0.0  # stałe oprocentowanie

    return {
        "code": code,
        "series": series,
        "url": url,
        "firstRate": first_rate,
        "margin": margin,
        "price": price or 100.0,
        "swapPrice": swap,
        "fee": fee if fee is not None else DEFAULT_FEES[code],
        "feeFromSite": fee is not None,
        "saleFrom": iso(sale.group(1)) if sale else None,
        "saleTo": iso(sale.group(2)) if sale else None,
        "periodFrom": iso(period.group(1)) if period else None,
    }


def main() -> int:
    print("Pobieram listę ofert...")
    home = get(BASE + "/")
    links = {}
    for path, code in re.findall(r'href="(/oferta-obligacji/[^"]+/([a-z]{3})\d{4}/)\s*"', home):
        links.setdefault(code.upper(), BASE + path)

    previous = {}
    if (HERE / "data.json").exists():
        try:
            previous = json.loads((HERE / "data.json").read_text(encoding="utf-8")).get("bonds", {})
        except (ValueError, OSError):
            previous = {}

    bonds, problems = {}, []
    for code in ORDER:
        url = links.get(code)
        if not url:
            problems.append(f"{code}: brak linku na stronie głównej")
            if code in previous:
                bonds[code] = previous[code] | {"stale": True}
            continue
        print(f"  {code}: {url}")
        try:
            b = parse_bond(code, url, to_text(get(url)))
        except Exception as e:  # noqa: BLE001 - chcemy kontynuować dla pozostałych
            problems.append(f"{code}: błąd pobierania ({e})")
            if code in previous:
                bonds[code] = previous[code] | {"stale": True}
            continue
        missing = [k for k in ("series", "firstRate", "margin") if b[k] is None]
        if missing:
            problems.append(f"{code}: nie odczytano {', '.join(missing)}")
            if code in previous:
                b = {k: (v if v is not None else previous[code].get(k)) for k, v in b.items()}
        bonds[code] = b

    data = {
        "source": BASE,
        "fetchedAt": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "bonds": bonds,
        "problems": problems,
    }
    js = json.dumps(data, ensure_ascii=False, indent=2)
    (HERE / "data.json").write_text(js + "\n", encoding="utf-8")
    (HERE / "data.js").write_text(
        "// Wygenerowane przez fetch_bonds.py - nie edytuj ręcznie\nwindow.BOND_DATA = " + js + ";\n",
        encoding="utf-8")

    print(f"\nZapisano {len(bonds)} obligacji do data.json i data.js")
    for code in ORDER:
        b = bonds.get(code)
        if b:
            print(f"  {b['series']}: {b['firstRate']}% | marża {b['margin']}% | "
                  f"zamiana {b['swapPrice']} | opłata {b['fee']} zł")
    if problems:
        print("\nUWAGA:", *problems, sep="\n  ")
    return 1 if len(bonds) < len(ORDER) else 0


if __name__ == "__main__":
    sys.exit(main())
