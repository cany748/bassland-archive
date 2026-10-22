// Сбор стен пабликов в data/<паблик>.jsonl.gz.
//   npm run collect                 — все паблики
//   npm run collect -- bassland lite — выбранные
// Первый проход идёт по всей стене от новых постов к старым и переживает перезапуск:
// прогресс — в data/state.json, посты — в data/<паблик>.partial.jsonl. Когда архив уже
// собран, повторный запуск дочитывает только новые посты — до первой страницы без новых.
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GROUPS } from "./groups.js";
import { readJsonl, writeJsonlGz } from "./jsonl.js";
import { createWallClient } from "./vk.js";

const DATA = new URL("../data/", import.meta.url).pathname;
const STATE = join(DATA, "state.json");
const PAGE = 100;
const PAUSE_MS = 1500;
// стена живая: пока идёт сбор, сверху появляются посты и offset съезжает
const OVERLAP = 5;

const log = (message) => {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  appendFileSync(join(DATA, "collect.log"), `${line}\n`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const pickArtists = (artists) => artists?.map((artist) => artist.name);

const slimAttachment = (attachment) => {
  const value = attachment[attachment.type];
  if (!value) return { type: attachment.type };
  switch (attachment.type) {
    case "audio":
      return {
        type: "audio",
        owner_id: value.owner_id,
        id: value.id,
        artist: value.artist,
        title: value.title,
        subtitle: value.subtitle,
        duration: value.duration,
        main_artists: pickArtists(value.main_artists),
        featured_artists: pickArtists(value.featured_artists),
        album: value.album ? { owner_id: value.album.owner_id, id: value.album.id, title: value.album.title } : undefined,
        genre_id: value.genre_id,
        date: value.date,
      };
    case "audio_playlist":
      return {
        type: "audio_playlist",
        owner_id: value.owner_id,
        id: value.id,
        access_key: value.access_key,
        title: value.title,
        count: value.count,
        year: value.year,
        genres: value.genres?.map((genre) => genre.name),
        main_artists: pickArtists(value.main_artists),
        original: value.original,
      };
    case "photo": {
      const largest = [...(value.sizes ?? [])].sort((a, b) => a.width * a.height - b.width * b.height).pop();
      return { type: "photo", owner_id: value.owner_id, id: value.id, url: largest?.url, width: largest?.width, height: largest?.height };
    }
    case "video":
      return { type: "video", owner_id: value.owner_id, id: value.id, title: value.title, duration: value.duration };
    case "link":
      return { type: "link", url: value.url, title: value.title };
    case "doc":
      return { type: "doc", title: value.title, ext: value.ext, url: value.url };
    default:
      return { type: attachment.type };
  }
};

const slimPost = (post) => ({
  owner_id: post.owner_id,
  id: post.id,
  date: post.date,
  text: post.text,
  attachments: (post.attachments ?? []).map(slimAttachment),
  ...(post.copy_history?.length
    ? {
        copy_history: post.copy_history.map((copy) => ({
          owner_id: copy.owner_id,
          id: copy.id,
          date: copy.date,
          text: copy.text,
          attachments: (copy.attachments ?? []).map(slimAttachment),
        })),
      }
    : {}),
});

const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
const saveState = () => writeFileSync(STATE, JSON.stringify(state, null, 1));

const collectGroup = async (name) => {
  const group = GROUPS[name];
  const archive = join(DATA, `${name}.jsonl.gz`);
  const partial = join(DATA, `${name}.partial.jsonl`);
  const posts = new Map([...readJsonl(archive), ...readJsonl(partial)].map((post) => [post.id, post]));
  state[name] ??= { offset: 0, updating: existsSync(archive) };
  const { updating } = state[name];
  saveState();

  const { getWall } = createWallClient({ domain: group.domain, log });
  log(`${group.title}: ${updating ? "дочитываю новые посты" : `сбор с offset ${state[name].offset}`}, в архиве ${posts.size}`);

  while (true) {
    const page = await getWall({ owner_id: -group.id, count: PAGE, offset: Math.max(0, state[name].offset - OVERLAP) });
    let fresh = 0;
    for (const post of page.items) {
      if (post.marked_as_ads || posts.has(post.id)) continue;
      const slim = slimPost(post);
      posts.set(post.id, slim);
      appendFileSync(partial, `${JSON.stringify(slim)}\n`);
      fresh++;
    }
    state[name].offset += page.items.length;
    saveState();
    log(`${group.title}: ${Math.min(state[name].offset, page.count)}/${page.count}, новых ${fresh}`);
    if (page.items.length === 0 || state[name].offset >= page.count || (updating && fresh === 0)) break;
    await sleep(PAUSE_MS);
  }

  writeJsonlGz(archive, [...posts.values()].sort((a, b) => b.id - a.id));
  rmSync(partial, { force: true });
  delete state[name];
  saveState();
  log(`${group.title}: в архиве ${posts.size} постов`);
};

const names = process.argv.slice(2);
for (const name of names.length > 0 ? names : Object.keys(GROUPS)) {
  if (!GROUPS[name]) throw new Error(`неизвестный паблик «${name}», есть: ${Object.keys(GROUPS).join(", ")}`);
  await collectGroup(name);
}
