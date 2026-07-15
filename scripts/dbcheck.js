// End-to-end pipeline check: reads the historian's SQLite file directly, because the
// destination is the only place that can't lie. Run from the repo root: node scripts/dbcheck.js
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("historian/plantfloor.db");

const lastTemps = db.prepare(
  "SELECT payload FROM readings WHERE topic LIKE '%temperature' ORDER BY id DESC LIMIT 5"
).all().map(r => JSON.parse(r.payload).ts);
console.log("last 5 temperature publish times (expect ~3s apart):", lastTemps);

console.log(db.prepare(
  "SELECT COUNT(*) AS total, COUNT(DISTINCT topic || payload) AS distinct_msgs FROM readings"
).get());
