import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";

export const readJsonl = (path) => {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path);
  const text = path.endsWith(".gz") ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
};

export const writeJsonlGz = (path, rows) => {
  writeFileSync(path, gzipSync(rows.map((row) => JSON.stringify(row)).join("\n") + "\n", { level: 9 }));
};
