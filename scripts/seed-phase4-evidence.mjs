import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const dir = process.env.PGLITE_DATA_DIR;
if (!dir) throw new Error("Set PGLITE_DATA_DIR to an isolated test directory");
const db = new PGlite(dir);
await db.exec(await readFile("db/schema.sql", "utf8"));
await db.query(
  `INSERT INTO simulation_runs (id,seed,config,completed_at,results)
   VALUES ('phase4-preserved-run','fixed-seed','{"population":10}'::jsonb,now(),'{"completed":true}'::jsonb)`,
);
await db.close();
console.log("Completed simulation evidence seeded in isolated database.");
