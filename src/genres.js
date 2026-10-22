// Жанры по разобранным постам: частотность, совместная встречаемость, переходы «A > B».
//   npm run genres                — по всем пабликам
//   npm run genres -- bassland    — по выбранным
// Пишет data/genres.json и печатает таблицу «жанр, постов, с чем чаще встречается».
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { GROUPS } from "./groups.js";
import { readJsonl } from "./jsonl.js";

const DATA = new URL("../data/", import.meta.url).pathname;

// кириллица и диакритика, которыми набраны «латинские» теги, и устойчивые опечатки
const HOMOGLYPHS = Object.fromEntries([..."аеорсухіíАЕОРСХТНВМК"].map((char, i) => [char, "aeopcyxiiAEOPCXTHBMK"[i]]));
const TYPOS = {
  fututrebeats: "FutureBeats",
  electronickrock: "Electronic Rock",
  carmival: "Carnival",
  jeseyclub: "JerseyClub",
  mombahton: "Moombahton",
  moombathon: "Moombahton",
  tecnho: "Techno",
  neruofunk: "Neurofunk",
  ducthhouse: "DutchHouse",
  elecrtohouse: "ElectroHouse",
  futuredubtep: "FutureDubstep",
  "drum&bass": "DrumandBass",
  "jerseyclub@thebassland": "JerseyClub",
  hardstlye: "Hardstyle",
  liqiud: "Liquid",
  futuregrage: "FutureGarage",
  basshousee: "BassHouse",
  rnb: "R&B",
};

const deHomoglyph = (name) => [...name].map((char) => HOMOGLYPHS[char] ?? char).join("");
// мусор вроде «#1» или одиночных символов жанром не считаем
const isGenre = (name) => /[A-Za-zА-Яа-я]{2}/.test(name);
const cleanList = (names) => names.filter(isGenre).map(deHomoglyph);

const increment = (map, key, by = 1) => map.set(key, (map.get(key) ?? 0) + by);
const sortedEntries = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]);

const names = process.argv.slice(2);
const posts = (names.length > 0 ? names : Object.keys(GROUPS)).flatMap((name) => readJsonl(join(DATA, "parsed", `${name}.jsonl.gz`)));
for (const post of posts) {
  post.genres = cleanList(post.genres);
  post.genre_flow = (post.genre_flow ?? []).map(cleanList);
}

// написания одного жанра (DrumAndBass, Drum and Bass, Drum-and-Bass) сводим к самому частому
const spellings = new Map();
for (const post of posts) {
  for (const genre of post.genres) {
    const key = genre.toLowerCase().replace(/[\s-]/g, "");
    if (!spellings.has(key)) spellings.set(key, new Map());
    increment(spellings.get(key), genre);
  }
}
const canon = {};
for (const [key, counts] of spellings) {
  const best = TYPOS[key] ?? sortedEntries(counts)[0][0];
  for (const spelling of counts.keys()) canon[spelling] = best;
}

const frequency = new Map();
const cooccurrence = new Map();
const transitions = new Map();
const details = new Map();
for (const post of posts) {
  const genres = [...new Set(post.genres.map((genre) => canon[genre]))].sort();
  for (const genre of genres) increment(frequency, genre);
  for (let i = 0; i < genres.length; i++) for (let j = i + 1; j < genres.length; j++) increment(cooccurrence, `${genres[i]}\t${genres[j]}`);
  const flow = post.genre_flow.map((segment) => segment.map((genre) => canon[genre]));
  for (let i = 0; i + 1 < flow.length; i++) for (const from of flow[i]) for (const to of flow[i + 1]) increment(transitions, `${from}\t${to}`);
  for (const [genre, detail] of post.genre_details ?? []) increment(details, `${genre ? (canon[genre] ?? genre) : ""}\t${detail}`);
}

const companions = {};
for (const [pair, count] of cooccurrence) {
  const [a, b] = pair.split("\t");
  (companions[a] ??= []).push([b, count, count / frequency.get(a)]);
  (companions[b] ??= []).push([a, count, count / frequency.get(b)]);
}
for (const genre of Object.keys(companions)) companions[genre] = companions[genre].sort((x, y) => y[1] - x[1]).slice(0, 8);

const split = (map) => sortedEntries(map).map(([key, count]) => [...key.split("\t"), count]);
writeFileSync(
  join(DATA, "genres.json"),
  JSON.stringify(
    { canon, frequency: sortedEntries(frequency), cooccurrence: split(cooccurrence), transitions: split(transitions), details: split(details), companions },
    null,
    1,
  ),
);

for (const [genre, count] of sortedEntries(frequency)) {
  const top = (companions[genre] ?? []).slice(0, 4).map(([other, n]) => `${other} ${n} (${Math.round((100 * n) / count)}%)`);
  console.log(`${genre}\t${count}\t${top.join(", ")}`);
}
