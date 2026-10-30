// Prepares a real-DB copy and range list for the expansion parity check.
// Usage:
//   node scripts/parity-prepare.mjs
//   PARITY_DB=<printed> PARITY_IN=<printed> PARITY_OUT=<printed> cargo test -- --ignored expanded_dump
//   npx vitest run src/lib/parity.test.ts
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const srcDir = join(process.env.APPDATA, "TutorApp");
const dstDir = join(tmpdir(), "tutor-parity");
mkdirSync(dstDir, { recursive: true });

// Copy db + WAL/SHM so un-checkpointed state is preserved.
for (const f of ["tutor.db", "tutor.db-wal", "tutor.db-shm"]) {
  const p = join(srcDir, f);
  if (existsSync(p)) copyFileSync(p, join(dstDir, f));
}

const now = new Date();
const sod = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const eod = (d) => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};

const monday = sod(now);
monday.setDate(monday.getDate() - ((now.getDay() + 6) % 7));
const sundayEnd = eod(new Date(monday));
sundayEnd.setDate(sundayEnd.getDate() + 6);
const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
const monthEnd = eod(new Date(now.getFullYear(), now.getMonth() + 1, 0));
const histFrom = sod(new Date(now.getFullYear() - 2, now.getMonth(), now.getDate()));
const histTo = eod(new Date(now.getFullYear(), now.getMonth() + 2, now.getDate()));

const ranges = [
  { name: "today", from: sod(now).toISOString(), to: eod(now).toISOString() },
  { name: "week", from: monday.toISOString(), to: sundayEnd.toISOString() },
  { name: "month", from: monthStart.toISOString(), to: monthEnd.toISOString() },
  { name: "history", from: histFrom.toISOString(), to: histTo.toISOString() },
];

const inPath = join(dstDir, "parity_in.json");
writeFileSync(inPath, JSON.stringify({ ranges }));
console.log(
  JSON.stringify(
    {
      db: join(dstDir, "tutor.db"),
      in: inPath,
      out: join(dstDir, "parity_out.json"),
    },
    null,
    0,
  ),
);
