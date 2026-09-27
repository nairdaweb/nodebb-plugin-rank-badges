# nodebb-plugin-rank-badges

Odznaki rang dla **NodeBB 4.x**. Użytkownicy zdobywają rangi za liczbę postów i/lub reputację,
a członkowie wybranych grup (Administrator, Moderator albo dowolna inna grupa) dostają zamiast
rangi odznakę grupy. Odznaka jest przy nazwie autora w postach i na profilu.

*English: [README.md](README.md).*

- **Zgodność:** NodeBB `^4.0.0` (4.x), Node.js 18 lub nowszy.
- **Autor:** [nairda](https://wirelab.pl)
- **Kod i zgłoszenia:** [github.com/nairdaweb/nodebb-plugin-rank-badges](https://github.com/nairdaweb/nodebb-plugin-rank-badges) ·
  [zgłoś błąd](https://github.com/nairdaweb/nodebb-plugin-rank-badges/issues)

![Odznaki w postach (jasny)](https://raw.githubusercontent.com/nairdaweb/nodebb-plugin-rank-badges/main/docs/screenshot-posts-light.png)
![Odznaki w postach (ciemny)](https://raw.githubusercontent.com/nairdaweb/nodebb-plugin-rank-badges/main/docs/screenshot-posts-dark.png)

## Możliwości

- **Rangi** z progami postów i reputacji. Tryby: oba progi (domyślnie), tylko posty, tylko reputacja,
  dowolny z progów. Użytkownik dostaje najwyższą rangę z listy, której progi spełnia.
- **Odznaki grup** dla dowolnych grup; pierwsza pasująca grupa z listy ma pierwszeństwo przed rangą.
  Moderatorzy kategorii mogą dostać odznakę „Global Moderators”.
- **Nazwy w wielu językach** wpisane w ACP albo tłumaczenia z plików językowych pluginu
  (en-GB, en-US, pl) dla domyślnych rang.
- **Pasek poziomu** (segment na każdą rangę) i opcjonalny **obrazek** rangi. Gdy obrazek się nie wczyta,
  pojawia się pasek.
- **Dostępność**: znaczenie niesie zawsze widoczna nazwa (kolor to tylko akcent), `aria-label`
  „Ranga 3 z 6: Majsterkowicz”, czytelny kontrast w jasnym i ciemnym motywie, obsługa `forced-colors`.
- **Wydajność**: ustawienia i gotowe odznaki są w pamięci, członkostwo w grupach sprawdzane raz na grupę
  dla wszystkich autorów na stronie (bez dodatkowych zapytań na każdy post).
- **Łatwe do ostylowania**: kolory i rozmiary to zmienne CSS.

Domyślna drabina (wszystko zmienisz w ACP):

| Poziom | pl | en-GB | Posty | Reputacja |
|---|---|---|---|---|
| 1 | Nowy na warsztacie | New at the bench | 0 | 0 |
| 2 | Praktykant | Apprentice | 5 | 0 |
| 3 | Majsterkowicz | Tinkerer | 25 | 5 |
| 4 | Technik | Technician | 75 | 20 |
| 5 | Inżynier | Engineer | 200 | 50 |
| 6 | Konstruktor | Builder | 500 | 150 |
| – | Administrator | Administrator | grupa `administrators` | |
| – | Moderator | Moderator | grupa `Global Moderators` | |

## Instalacja

W katalogu NodeBB:

```sh
cd /ścieżka/do/nodebb
npm install nodebb-plugin-rank-badges
./nodebb activate nodebb-plugin-rank-badges
./nodebb build
./nodebb restart
```

Można też zainstalować i włączyć plugin w **ACP → Rozszerzenia → Wtyczki**, a potem przebudować i zrestartować forum.

Zgodność: NodeBB `^4.0.0` (pole `nbbpm.compatibility` w `package.json`); wymaga Node.js 18+.
NodeBB 3.x i starsze nie są obsługiwane.

## Konfiguracja

**ACP → Wtyczki → Rank badges**

![ACP](https://raw.githubusercontent.com/nairdaweb/nodebb-plugin-rank-badges/main/docs/screenshot-acp.png)

- *How ranks are earned* — tryb opisany wyżej.
- *Languages for rank names* — kolumny nazw (np. `en-GB, pl, de`). Pusta nazwa = tłumaczenie z pluginu
  (domyślne rangi) albo pierwsza podana nazwa.
- *Ranks* — kolejność ma znaczenie (poziom = pozycja). Obrazek: upload (zapis w `uploads/rank-badges/`)
  albo adres zaczynający się od `/` lub `https://`; kwadrat, min. 64 px. Kolor `#rrggbb` jako akcent.
- *Group badges* — nazwa grupy dokładnie jak w ACP → Grupy, nazwa odznaki, ikona Font Awesome
  (`fa-shield-halved`), obrazek, kolor.
- *Add badge to posts automatically* — używa miejsca `custom_profile_info`, które Harmony i Persona
  wyświetlają przy nazwie autora. Wyłącz, jeśli motyw sam wypisuje odznakę.
- *Presety* — katalog w `presets/` z `preset.json` i obrazkami ([presets/README.md](presets/README.md)).
  „Load preset” wypełnia tabele; nic się nie zmienia, dopóki nie klikniesz Zapisz. Paczka npm nie zawiera
  grafik presetów; preset `wirelab` jest dostępny tylko w repozytorium GitHub (zob. Licencja).

## Dla autorów motywów

Dane posta dostają `user.rankBadge` (`level`, `total`, `tier`, `special`, `key`, `group`, `image`,
`color`, `name`, `html`). W szablonie: `{{{ if posts.user.rankBadge }}}{{posts.user.rankBadge.html}}{{{ end }}}`.

Kodowanie: `html` to gotowy, bezpieczny znacznik. `name` jest bezpieczne w HTML (nazwy z ACP są escapowane przy zapisie). `group` to surowa nazwa grupy — escapuj ją, jeśli wypisujesz ją sam.
Jeśli wypisujesz odznakę sam, pomiń wpisy `custom_profile_info` z `rankBadge: true` (albo wyłącz
automatyczne dodawanie). Stylowanie: nadpisz zmienne `--rank-badge-*` (lista w README.md).

API tylko do odczytu (np. strona „Rangi”): `GET /api/v3/plugins/rank-badges/ladder?lang=pl`.

## Rozwój

```sh
npm install
npm test
npm run lint
```

## Licencja

- **Kod:** MIT © [nairda](https://wirelab.pl), zob. [LICENSE](LICENSE).
- **Grafiki presetu `wirelab`** (`presets/wirelab/*.png`, `*.svg`): © nairda (wirelab.pl), **nie** są
  objęte licencją MIT i nie wchodzą do paczki npm. Warunki:
  [presets/wirelab/LICENSE.md](https://github.com/nairdaweb/nodebb-plugin-rank-badges/blob/main/presets/wirelab/LICENSE.md).
