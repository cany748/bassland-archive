// Полнота метаданных по разобранным постам: npm run stats [-- паблик …] → data/stats.json
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { GROUPS } from "./groups.js";
import { readJsonl } from "./jsonl.js";

const DATA = new URL("../data/", import.meta.url).pathname;

const statsOf = (posts) => {
  const counts = {};
  const add = (key, condition = true) => {
    if (condition) counts[key] = (counts[key] ?? 0) + 1;
  };
  const years = {};
  let audios = 0;
  let playlists = 0;
  for (const post of posts) {
    const hasMedia = post.audios.length > 0 || post.playlists.length > 0;
    add("with_audio", post.audios.length > 0);
    add("with_playlist", post.playlists.length > 0);
    add("repost", Boolean(post.repost_of));
    add("no_media", !hasMedia);
    if (hasMedia) {
      // доля метаданных считается только по постам с музыкой: остальное — новости и реклама
      add("media");
      add("m_label", Boolean(post.label_raw));
      add("m_date", post.release_dates.length > 0);
      add("m_year", Boolean(post.release_year));
      add("m_genre", post.genres.length > 0);
      add("m_headline", Boolean(post.release_title));
      add("m_any_meta", Boolean(post.label_raw || post.release_dates.length > 0 || post.genres.length > 0 || post.flags.length > 0));
      add("multi_date", post.release_dates.length > 1);
      add("multi_genre", post.genres.length > 1);
      add("genre_untagged", post.genre_tagged === false);
      add("genre_flow", (post.genre_flow ?? []).length > 1);
      for (const flag of post.flags) add(`f_${flag}`);
    }
    audios += post.audios.length;
    playlists += post.playlists.length;
    if (post.date) {
      const year = new Date(post.date * 1000).getUTCFullYear();
      years[year] = (years[year] ?? 0) + 1;
    }
  }
  return { posts: posts.length, ...counts, audios, playlists, years };
};

const names = process.argv.slice(2);
const result = {};
for (const name of names.length > 0 ? names : Object.keys(GROUPS)) result[name] = statsOf(readJsonl(join(DATA, "parsed", `${name}.jsonl.gz`)));
writeFileSync(join(DATA, "stats.json"), JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1));
