import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";

const dir = process.env.PGLITE_DATA_DIR;
if (!dir) throw new Error("Set PGLITE_DATA_DIR to the isolated test directory");
const db = new PGlite(dir);
const rows = (await db.query("SELECT id,seed,config,results,completed_at FROM simulation_runs WHERE id='phase4-preserved-run'")).rows;
assert.equal(rows.length, 1);
assert.equal(rows[0].seed, "fixed-seed");
assert.ok(rows[0].completed_at);
assert.deepEqual(rows[0].results, { completed: true });
await db.close();
console.log("Completed simulation evidence preserved after reset.");
