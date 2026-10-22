# BASSLAND archive

Архив стен VK-пабликов [BASSLAND](https://vk.com/thebassland), [BASSLAND Lite](https://vk.com/theblite),
[BASSLAND Native](https://vk.com/theblative) и [BASSLAND Archives](https://vk.com/theblarch) — полная история
постов с 2011 года и разбор их метаданных: исполнители, релиз, лейбл, дата релиза, жанры с поджанрами,
прикреплённые треки и плейлисты.

Собран для переноса личной музыкальной библиотеки: у почти всех треков, взятых из BASSLAND, в посте есть
жанры, лейбл и дата релиза, которых нет в самом аудио VK.

## Данные

| Паблик | Постов | Период | с жанром* | с лейблом* | с датой* |
|---|---|---|---|---|---|
| BASSLAND | 63 964 | 2013–2026 | 89% | 59% | 62% |
| BASSLAND Lite | 9 463 | 2011–2026 | 87% | 65% | 71% |
| BASSLAND Native | 438 | 2024–2026 | 99% | 56% | 71% |
| BASSLAND Archives | 204 | 2023–2026 | 96% | 62% | 69% |

\* среди постов с музыкой; точные цифры — `data/stats.json`. Состояние на 22.10.2026.

- `data/<паблик>.jsonl.gz` — посты как есть, без рекламы и служебных полей VK: `owner_id`, `id`, `date`,
  `text`, `attachments`, `copy_history` (репосты). Вложения: `audio` (id, исполнитель, название,
  длительность, альбом), `audio_playlist`, `photo` (только самый большой размер — обложка), `video`, `link`, `doc`.
  Посты отсортированы от новых к старым.
- `data/parsed/<паблик>.jsonl.gz` — разобранные посты:

  ```json
  {
    "id": 902762, "date": 1790851771,
    "headline": "Excision & SpaceLaces - True Killers",
    "artist_tags": ["Excision", "SpaceLaces"], "artists": "Excision & SpaceLaces",
    "release_title": "True Killers",
    "label_raw": "NeverSayDie Records", "label_tags": ["NeverSayDie"],
    "release_dates": ["2026-10-02"], "release_year": 2026,
    "genres": ["Dubstep"], "genre_details": [], "genre_flow": [["Dubstep"]],
    "genre_raw": "Dubstep", "genre_tagged": true,
    "flags": [], "category_tags": [], "other_tags": [],
    "audios": [{ "owner_id": 2000010833, "id": 456246701, "artist": "Excision & Space Laces", "title": "True Killers", "duration": 226 }],
    "playlists": []
  }
  ```

  `genre_flow` — смена жанра по ходу трека (`Genre: #Dubstep > #Riddim` → `[["Dubstep"], ["Riddim"]]`),
  `genre_details` — уточнения в скобках (`#DrumandBass (Liquid)`), `flags` — `self_released`, `free_download`,
  `limited_release`, `private_download`, `various_labels`, `repost_of` — у репостов.
- `data/genres.json`, `data/genres.tsv` — частотность жанров (написания и опечатки сведены), с чем жанр
  встречается вместе, переходы «A > B».
- `data/stats.json` — полнота метаданных по пабликам и годам.

## Как устроен сбор

Аккаунт VK не нужен. vk.ru выдаёт каждому посетителю анонимный токен (JWT `anonym.…`, живёт сутки) и сам
грузит стену запросом `wall.get` к `api.vk.ru`. Скрипт делает то же: открывает паблик в чистом профиле Chrome,
перехватывает токен и дальше запрашивает стену по 100 постов с паузой 1,5 с. Полный проход всех четырёх
пабликов — около 740 запросов и полутора часов. Лимиты VK (`Flood control`) скрипт пережидает, а не долбит.

## Использование

Нужны Node.js 22+ и установленный Google Chrome (`playwright-core` запускает системный Chrome).

```bash
npm install
npm run collect                 # дочитать новые посты всех пабликов (или полный сбор, если архива нет)
npm run collect -- bassland     # только выбранные: bassland, lite, native, archives
npm run parse                   # data/<паблик>.jsonl.gz → data/parsed/
npm run genres > data/genres.tsv
npm run stats
```

Полный сбор переживает перезапуск: прогресс хранится в `data/state.json`, собранное — в
`data/<паблик>.partial.jsonl`. Когда архив уже есть, `collect` идёт от новых постов к старым и
останавливается на первой странице без новых.

## Формат постов и разбор

```
#Excision@thebassland & #SpaceLaces@thebassland - True Killers
Label: #NeverSayDie@thebassland Records
Release Date: 02.10.2026
Genre: #Dubstep@thebassland
```

- Заголовок «Исполнители - Релиз» — последняя непустая строка перед первой строкой метаданных
  (`Label:`, `Release Date`, `Genre:`, `Self-Released`, `Free Download`…).
- Хэштеги вида `#Имя@thebassland` разворачиваются в `Имя`; в лейблах и исполнителях пробелов нет
  (`#NeverSayDie`), полное название — в `label_raw`.
- Дат может быть несколько (`29.09 / 02.10.2026`); без даты релиза год берётся из скобок:
  `Free Download (2013)`.
- Жанры: `/` и `,` — альтернативы, `>` — смена жанра по ходу трека, скобки — уточнение предыдущего жанра.
  Хвост строки со ссылками и «Support/Buy» отрезается.
- Репост без текста разбирается целиком по оригиналу; у репоста с подписью пустые поля добираются из оригинала.
