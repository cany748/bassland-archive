// Разбор постов в метаданные релиза: data/<паблик>.jsonl.gz → data/parsed/<паблик>.jsonl.gz
//   npm run parse                  — все паблики
//   npm run parse -- bassland      — выбранные
// Формат поста BASSLAND:
//   #Excision@thebassland & #SpaceLaces@thebassland - True Killers
//   Label: #NeverSayDie@thebassland Records
//   Release Date: 02.10.2026
//   Genre: #Dubstep@thebassland #Riddim@thebassland
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { GROUPS } from "./groups.js";
import { readJsonl, writeJsonlGz } from "./jsonl.js";

const DATA = new URL("../data/", import.meta.url).pathname;

const TAG = /#([^\s#@\][|,/]+)@[\w.]+/gi;
const ANY_TAG = /#([^\s#@\][|]+)(?:@[\w.]+)?/g;
const DATE = /\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/g;
const META = /^\s*(label|various labels|private download|release date|g[ae][nm]?re?s?\s*[:"]|self[- ]released|free download|limited release|support)/i;
const GENRE_LINE = /^g[ae][nm]?re?s?\s*[:"]/i;
const GENRE_PREFIX = /^\s*g[ae][nm]?re?s?\s*[:"]\s*/i;
// хвост строки жанров, который к жанрам не относится (ссылки, призывы купить)
const GENRE_TAIL = /\s(?:Support|Buy|Artist VK|Free Download|Label|Full Compilation)\b|\[#alias|\[club|\[id\d|https?:/;
const GENRE_TOKEN = /#([^\s#@,/>()]+)(?:@[\w.]+)?|\(([^)]*)\)?|([^#(/>,]+)/g;
const HEADLINE_SEPARATOR = /\s[-–—]\s/;
const CATEGORIES = new Set(["native", "classic", "news", "preview", "mix", "dontmiss", "brandnew", "video", "top", "backstage", "chillout", "basslandshow", "bassland", "premiere", "exclusive"]);

const tagsOf = (text) => [...text.matchAll(TAG)].map((match) => match[1]);
const anyTagsOf = (text) => [...text.matchAll(ANY_TAG)].map((match) => match[1]);
const trimChars = (text, chars) => {
  let start = 0;
  let end = text.length;
  while (start < end && chars.includes(text[start])) start++;
  while (end > start && chars.includes(text[end - 1])) end--;
  return text.slice(start, end);
};

const untag = (text) =>
  text
    .replace(/\[#alias\|[^|\]]*\|([^\]]*)\]/g, "$1")
    .replace(TAG, "$1")
    .replace(/\s+/g, " ")
    .trim();

// «Genre: #DrumandBass (Liquid) / #Dubstep > #Riddim»: «/» и «,» — альтернативы, «>» —
// смена жанра по ходу трека, в скобках — уточнение предыдущего жанра
const parseGenres = (line) => {
  const body = line.replace(GENRE_PREFIX, "").trim().split(GENRE_TAIL)[0].trim();
  const names = [];
  const details = [];
  const flow = [];
  for (const segment of body.split(">")) {
    const alternatives = [];
    let last = null;
    for (const part of segment.split(/[/,]/)) {
      for (const [, tag, paren, plain] of part.matchAll(GENRE_TOKEN)) {
        if (tag) {
          alternatives.push(tag);
          last = tag;
        } else if (paren !== undefined && paren.trim()) {
          details.push([last, paren.trim()]);
        } else if (plain && trimChars(plain, " .;)")) {
          const name = trimChars(plain, " .;)");
          alternatives.push(name);
          last = name;
        }
      }
    }
    if (alternatives.length > 0) {
      flow.push(alternatives);
      names.push(...alternatives);
    }
  }
  return { genres: [...new Set(names)], details, flow, raw: body, tagged: body.includes("#") };
};

const parseBody = (post) => {
  const text = post.text ?? "";
  const lines = text.split("\n");

  // заголовок «Исполнители - Релиз» — последняя непустая строка перед первой строкой метаданных
  const firstMeta = lines.findIndex((line) => META.test(line));
  let headline = null;
  for (let i = firstMeta - 1; firstMeta > 0 && i >= 0; i--) {
    if (lines[i].trim()) {
      headline = lines[i].trim();
      break;
    }
  }

  let label = null;
  let dateLine = null;
  let genreLine = null;
  const flags = new Set();
  for (const line of lines) {
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();
    if (lower.startsWith("label:")) label = trimmed.slice(6).trim();
    else if (lower.startsWith("release date")) dateLine = trimmed;
    else if (GENRE_LINE.test(lower)) genreLine = trimmed;

    if (/^(self[- ]released|free download|limited release|private download|various labels)/.test(lower) || lower.startsWith("label:")) {
      if (lower.includes("private download")) flags.add("private_download");
      if (lower.startsWith("various labels")) flags.add("various_labels");
      // «Free Download on #Label» — лейбл живёт в той же строке
      const onLabel = trimmed.match(/\bon\s+(#\S+.*)$/);
      if (onLabel && !lower.startsWith("label:") && label === null) label = onLabel[1].trim();
      if (lower.includes("self-released") || lower.includes("self released")) flags.add("self_released");
      if (lower.includes("free download")) flags.add("free_download");
      if (lower.includes("limited release")) flags.add("limited_release");
    }
  }

  let artistsPart = null;
  let title = null;
  const separator = headline?.match(HEADLINE_SEPARATOR);
  if (separator) {
    artistsPart = headline.slice(0, separator.index);
    title = headline.slice(separator.index + separator[0].length);
  }

  const releaseDates = dateLine ? [...dateLine.matchAll(DATE)].map(([, day, month, year]) => `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`) : [];
  // без даты релиза остаётся год в скобках: «Free Download (2013)»
  const yearOnly = releaseDates.length === 0 ? text.match(/(?:free download|self[- ]released|limited release|label:[^\n]*)\((\d{4})\)/i) : null;
  const genre = genreLine ? parseGenres(genreLine) : null;
  const genres = genre?.genres ?? [];
  const artistTags = artistsPart ? tagsOf(artistsPart) : [];
  const labelTags = label ? tagsOf(label) : [];
  const known = new Set([...genres, ...artistTags, ...labelTags]);
  const allTags = anyTagsOf(text);

  return {
    headline: headline ? untag(headline) : null,
    artist_tags: artistTags,
    artists: artistsPart ? untag(artistsPart) : null,
    release_title: title ? untag(title) : null,
    label_raw: label ? untag(label) : null,
    label_tags: labelTags,
    release_dates: releaseDates,
    release_year: releaseDates.length > 0 ? Number(releaseDates[0].slice(0, 4)) : yearOnly ? Number(yearOnly[1]) : null,
    genres,
    genre_details: genre?.details ?? [],
    genre_flow: genre?.flow ?? [],
    genre_raw: genre ? untag(genre.raw) : null,
    genre_tagged: genre ? genre.tagged : null,
    flags: [...flags].sort(),
    category_tags: [...new Set(allTags.filter((tag) => CATEGORIES.has(tag.toLowerCase())))].sort(),
    other_tags: allTags.filter((tag) => !known.has(tag) && tag !== "alias"),
    audios: post.attachments
      .filter((attachment) => attachment.type === "audio")
      .map(({ owner_id, id, artist, title: audioTitle, duration }) => ({ owner_id, id, artist, title: audioTitle, duration })),
    playlists: post.attachments
      .filter((attachment) => attachment.type === "audio_playlist")
      .map(({ owner_id, id, title: listTitle, access_key, count, main_artists, year, original }) => ({
        owner_id,
        id,
        title: listTitle,
        access_key,
        count,
        main_artists: main_artists ?? [],
        year: year ?? null,
        original: original ?? null,
      })),
  };
};

const isEmpty = (value) => value === null || value === undefined || value === false || (Array.isArray(value) && value.length === 0) || value === "";

const parsePost = (post) => {
  const record = { id: post.id, date: post.date };
  const original = post.copy_history?.[0];
  let body;
  if (original && !post.text && post.attachments.length === 0) {
    // голый репост — всё берём из оригинала
    body = parseBody({ ...original, attachments: original.attachments ?? [] });
    record.repost_of = `${original.owner_id}_${original.id}`;
  } else {
    body = parseBody(post);
    if (original) {
      record.repost_of = `${original.owner_id}_${original.id}`;
      // репост с подписью: пустые поля добираем из оригинала
      const fromOriginal = parseBody({ ...original, attachments: original.attachments ?? [] });
      for (const [key, value] of Object.entries(fromOriginal)) if (isEmpty(body[key]) && !isEmpty(value)) body[key] = value;
    }
  }
  return { ...record, ...body };
};

const names = process.argv.slice(2);
mkdirSync(join(DATA, "parsed"), { recursive: true });
for (const name of names.length > 0 ? names : Object.keys(GROUPS)) {
  const posts = readJsonl(join(DATA, `${name}.jsonl.gz`));
  writeJsonlGz(join(DATA, "parsed", `${name}.jsonl.gz`), posts.map(parsePost));
  console.log(`${GROUPS[name].title}: разобрано ${posts.length}`);
}
