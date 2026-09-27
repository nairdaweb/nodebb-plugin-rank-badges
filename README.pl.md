# nodebb-plugin-rank-badges

Odznaki rang dla **NodeBB 4.x**. Użytkownicy zdobywają rangi za liczbę postów i/lub reputację,
a członkowie wybranych grup (Administrator, Moderator albo dowolna inna grupa) dostają zamiast
rangi odznakę grupy. Odznaka jest przy nazwie autora w postach i na profilu.

*English: [README.md](README.md).*

- **Zgodność:** NodeBB `^4.0.0`, testowane z NodeBB 4.16 i motywem Harmony; Node.js 22 lub nowszy
  (tego wymaga NodeBB 4.16).
- **Autor:** [nairda](https://wirelab.pl)
- **Kod i zgłoszenia:** [github.com/nairdaweb/nodebb-plugin-rank-badges](https://github.com/nairdaweb/nodebb-plugin-rank-badges) ·
  [zgłoś błąd](https://github.com/nairdaweb/nodebb-plugin-rank-badges/issues)

![Odznaki w postach (jasny)](https://raw.githubusercontent.com/nairdaweb/nodebb-plugin-rank-badges/main/docs/screenshot-posts-light.png)
![Odznaki w postach (ciemny)](https://raw.githubusercontent.com/nairdaweb/nodebb-plugin-rank-badges/main/docs/screenshot-posts-dark.png)

## Możliwości

- **Rangi** z progami postów i reputacji. Tryby: posty i reputacja (domyślnie), tylko posty, tylko
  reputacja, dowolny z progów. Użytkownik dostaje najwyższą rangę z listy, której progi spełnia.
- **Odznaki grup** dla dowolnych grup; odznaka grupy ma pierwszeństwo przed rangą. Moderatorzy
  kategorii mogą dostać odznakę „Global Moderators”.
- **Nazwy w wielu językach** wpisane w ACP albo tłumaczenia z plików językowych pluginu
  (en-GB, pl; pozostałe języki korzystają z en-GB) dla domyślnych rang.
- **Język oglądającego** wszędzie: przy pełnym wczytaniu strony, nawigacji ajaxify, infinite scroll,
  nowych odpowiedziach przychodzących przez websocket i w odpowiedziach API.
- **Pasek poziomu** (segment na każdą rangę albo „3/12” przy drabinie dłuższej niż 10 rang)
  i opcjonalny **obrazek** rangi lub grupy. Gdy obrazek się nie wczyta, pojawia się pasek, ikona grupy
  albo ogólna ikona.
- **Dostępność**: znaczenie niesie zawsze widoczna nazwa (kolor to tylko akcent), `aria-label`
  „Ranga 3 z 6: Majsterkowicz”, czytelny kontrast w jasnym i ciemnym motywie (odznaki grup same
  dobierają czarny lub biały tekst do koloru), obsługa `forced-colors`.
- **Wydajność**: ustawienia i gotowe odznaki są w pamięci, członkostwo w grupach sprawdzane raz na grupę
  dla wszystkich autorów na stronie (bez dodatkowych zapytań na każdy post).
- **Łatwe do ostylowania**: kolory i rozmiary to zmienne CSS.
- **ACP po angielsku i po polsku**, z walidacją, ostrzeżeniami i podglądem zapisanych odznak.

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

Deklarowana zgodność: NodeBB `^4.0.0` (pole `nbbpm.compatibility` w `package.json`); wymaga Node.js 22+.
NodeBB 3.x i starsze nie są obsługiwane.

## Konfiguracja

**ACP → Wtyczki → Odznaki rang**

![ACP](https://raw.githubusercontent.com/nairdaweb/nodebb-plugin-rank-badges/main/docs/screenshot-acp.png)

- *Jak zdobywa się rangi* — tryb, zob. [Jak liczone są rangi](#jak-liczone-są-rangi).
- *Języki nazw rang* — kolumny nazw (np. `en-GB, pl, de`). Pusta nazwa = tłumaczenie z pluginu
  (domyślne rangi), potem pierwsza podana nazwa, a na końcu „Ranga N”. Nazwy w językach usuniętych
  z tej listy są kasowane przy zapisie.
- *Rangi* — kolejność ma znaczenie (poziom = pozycja). Progi to liczby całkowite zapisane cyframi
  (`1e3`, `2.5` czy `-1` są odrzucane). Każda ranga potrzebuje nazwy w co najmniej jednym języku (albo
  klucza z plików językowych, jak domyślne rangi). Obrazek: upload (PNG, JPG, WebP, GIF lub SVG do
  512 KB, zapis w `uploads/rank-badges/` pod unikalną nazwą) albo adres zaczynający się od `/` lub
  `https://`; kwadrat, min. 64 px. Kolor `#rrggbb` jako akcent.
- *Odznaki grup* — nazwa grupy dokładnie jak w ACP → Grupy, nazwa odznaki, ikona Font Awesome
  (`fa-shield-halved`), obrazek, kolor, „Pokaż mimo ukrycia” (zob. niżej).
- *Dodawaj odznakę do postów automatycznie* — używa miejsca `custom_profile_info`, które Harmony
  i Persona wyświetlają przy nazwie autora. Wyłącz, jeśli motyw sam wypisuje odznakę.
- *Przywróć domyślne* — wstawia do tabel domyślne rangi i odznaki grup (zapis dopiero po kliknięciu Zapisz).
- *Presety* — zob. [Presety](#presety).

Zapis kończy się potwierdzeniem albo komunikatem o błędzie. Ustawienia są sprawdzane w przeglądarce
i ponownie na serwerze; niepoprawne nie zostaną zapisane. Jeśli ACP nie odczyta zapisanych ustawień,
zapis jest zablokowany, żeby domyślne wartości z formularza ich nie nadpisały. Pod tabelami ACP pokazuje
ostrzeżenia, które nie blokują zapisu: rangi w złej kolejności, rangi o tych samych progach, rangi
nieosiągalne, pustą listę rang, grupy nieistniejące lub ukryte.

### Jak liczone są rangi

- Rangi są sprawdzane w kolejności listy, a użytkownik dostaje **ostatnią** rangę, której progi spełnia,
  więc progi powinny rosnąć (ACP ostrzega, gdy tak nie jest).
- **Poziom 1 to ranga startowa.** Gdy jej liczone progi wynoszą 0, ma ją każdy, bez względu na liczbę
  postów i reputację (także ujemną).
- Przy każdej innej randze próg **0 oznacza „bez wymagania”** dla danego kryterium i sam nie daje
  rangi. Rangę zdobywa się przez jej niezerowe liczone progi:
  - *posty i reputacja*: trzeba spełnić wszystkie niezerowe progi;
  - *tylko posty* / *tylko reputacja*: trzeba spełnić niezerowy próg postów / reputacji;
  - *dowolny z progów*: wystarczy jeden niezerowy próg.

  Rangi (innej niż pierwsza), której wszystkie liczone progi wynoszą 0, nie da się zdobyć. Przykład:
  domyślna drabina w trybie *tylko reputacja* pomija poziom 2 (5 postów, 0 reputacji), więc
  użytkownik przechodzi z poziomu 1 od razu na poziom 3 przy 5 punktach reputacji.
- **Wyłączona reputacja** (ACP → Ustawienia → Reputacja): każdy tryb liczy tylko posty, tak samo
  w postach i na profilach. ACP wyświetla o tym informację.
- Pusta lista rang oznacza brak odznak rang (odznaki grup działają dalej). Domyślna drabina obowiązuje
  tylko do pierwszego zapisu ustawień.

### Odznaki grup

- **Pierwszeństwo**, niezależnie od kolejności członkostw użytkownika:
  1. `administrators`;
  2. `Global Moderators` — razem z moderatorami kategorii, gdy włączona jest opcja „Moderatorzy
     kategorii dostają odznakę Global Moderators” (i istnieje wpis `Global Moderators`);
  3. wszystkie pozostałe grupy w kolejności z listy w ACP.
- **Grupy ukryte:** NodeBB nie pokazuje członkostwa w grupach ukrytych i ten plugin też nie: odznaka
  grupy ukrytej nie jest wyświetlana, jeśli nie zaznaczysz „Pokaż mimo ukrycia” (domyślnie wyłączone).
  Nawet wtedy nazwa grupy nie trafia do znacznika (`data-group`) ani do danych API (`group` jest puste),
  a odznaka bez własnej nazwy nazywa się „Zespół”. Grupy prywatne (dołączanie za zgodą) są pokazywane
  normalnie: ich członkostwo jest w NodeBB publiczne, a `Global Moderators` jest grupą prywatną.
- **Nieistniejące grupy** są pomijane, a ACP o nich ostrzega. Odznaka grupy jest powiązana z **nazwą**
  grupy: jeśli skonfigurowana grupa zostanie usunięta, przemianowana albo jej nazwa ma literówkę, każdy
  z uprawnieniem do tworzenia grup może założyć grupę o tej nazwie i dać jej członkom odznakę. Zostaw
  uprawnienie „Tworzenie grup” zaufanym osobom i poprawiaj lub usuwaj wpisy, które ACP zgłasza jako
  nieistniejące.
- Istnienie grup i flaga „ukryta” są odczytywane ponownie co najmniej raz na minutę i przy każdym zapisie
  ustawień.

## Presety

Preset to katalog `presets/<id>/` z plikiem `preset.json` i obrazkami; każdy taki katalog o nazwie
złożonej tylko z `a-z`, `0-9` i `-` dostaje w ACP przycisk „Wczytaj preset”. Wczytanie wypełnia tabele;
nic się nie zmienia, dopóki nie klikniesz Zapisz. Obrazki muszą być zwykłymi nazwami plików w tym
katalogu z rozszerzeniem obrazka (`rank-1.png`, bez podkatalogów i `..`); inne są pomijane. Format:
[presets/README.md](presets/README.md).

Katalog jest częścią pluginu, więc samodzielnie dodany preset zniknie przy aktualizacji lub ponownej
instalacji: trzymaj jego kopię. Paczka npm nie zawiera presetów; preset `wirelab` jest dostępny tylko
w repozytorium GitHub (zob. Licencja).

Pliki presetów są serwowane jako pliki statyczne z domeny forum
(`/assets/plugins/nodebb-plugin-rank-badges/presets/…`), bez nagłówków ochronnych, które NodeBB dodaje
do uploadów użytkowników. Odznaki zawsze pokazują je przez `<img>`, gdzie skrypty SVG nie działają, ale
skrypt w SVG otwartym bezpośrednio wykonałby się w domenie forum: w `presets/` umieszczaj tylko zaufane
pliki SVG.

## Dla autorów motywów

Dane posta dostają `user.rankBadge` (`level`, `total`, `tier`, `special`, `key`, `group`, `image`,
`color`, `name`, `html`). W szablonie: `{{{ if posts.user.rankBadge }}}{{posts.user.rankBadge.html}}{{{ end }}}`.

Kodowanie:
- `html` to gotowy, przetłumaczony znacznik. Wszystko, co wpisano w ACP, jest zapisywane jako zwykły
  tekst i escapowane przy renderowaniu odznaki, a `[` i `]` są zapisywane jako `&lsqb;` / `&rsqb;`, więc
  nazwa nigdy nie stanie się tokenem tłumaczenia NodeBB, nawet jeśli znacznik zostanie przetłumaczony
  ponownie.
- `name` to HTML (escapowany tak samo), w języku oglądającego.
- `group` to surowa nazwa grupy, pusta dla grup ukrytych — escapuj ją, jeśli wypisujesz ją sam.
- Ustawienia odczytane bezpośrednio przez `meta.settings.get('rank-badges')` **nie** są escapowane.

Jeśli wypisujesz odznakę sam, pomiń wpisy `custom_profile_info` z `rankBadge: true` (albo wyłącz
automatyczne dodawanie). Wyniki wyszukiwania i listy postów na profilach korzystają ze skrótów postów
NodeBB, w których nie ma odznaki. Atrybuty odznaki i zmienne `--rank-badge-*` opisuje README.md.

API tylko do odczytu (np. strona „Rangi”): `GET /api/v3/plugins/rank-badges/ladder?lang=pl` zwraca tryb,
rangi i odznaki grup, które mogą pojawić się w postach (bez nazw grup). Odpowiada `403`, gdy oglądający
nie może czytać żadnej kategorii (np. gość na forum zamkniętym dla gości).

Obrazki z zewnętrznych adresów dostają `referrerpolicy="no-referrer"` i `loading="lazy"`, więc serwer
obrazka nie wie, jaki temat jest czytany; nadal widzi adres IP oglądającego, dlatego lepiej wgrywać obrazki.

## Rozwój

```sh
npm install
npm test
npm run lint
```

## Licencja

- **Kod:** MIT © [nairda](https://wirelab.pl), zob. [LICENSE](LICENSE).
- **Grafiki presetu `wirelab`** (`presets/wirelab/*.png`, `*.svg`): © nairda (wirelab.pl), **nie** są
  objęte licencją MIT i nie wchodzą do paczki npm. Warunki licencji nie zostały jeszcze ustalone (zob.
  `presets/wirelab/LICENSE.md` w repozytorium); do tego czasu żadna licencja nie jest udzielona.
