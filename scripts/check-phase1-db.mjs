import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite(".data/pglite");
const event = (await db.query("SELECT * FROM events ORDER BY created_at LIMIT 1")).rows[0];
if (!event) throw new Error("Seed event missing");
if (event.available + event.reserved + event.sold !== event.total_inventory) throw new Error("Inventory invariant failed");

let rejectedInvalidInventory = false;
try {
  await db.query(
    `INSERT INTO events (id,name,status,entry_opens_at,entry_closes_at,total_inventory,available,reserved,sold)
     VALUES ($1,'Invalid test','ENTRY_OPEN',now() - interval '1 hour',now() + interval '1 hour',500,499,0,0)`,
    [randomUUID()],
  );
} catch { rejectedInvalidInventory = true; }
if (!rejectedInvalidInventory) throw new Error("Inventory constraint did not reject invalid event");

const existing = (await db.query("SELECT * FROM queue_entries WHERE event_id = $1 LIMIT 1", [event.id])).rows[0];
let rejectedDuplicateEntry = false;
if (existing) {
  try {
    await db.query(
      "INSERT INTO queue_entries (id,event_id,account_id,state) VALUES ($1,$2,$3,'QUEUED')",
      [randomUUID(), event.id, existing.account_id],
    );
  } catch { rejectedDuplicateEntry = true; }
  if (!rejectedDuplicateEntry) throw new Error("Unique queue entry constraint failed");
}

const closedId = randomUUID();
await db.query(
  `INSERT INTO events (id,name,status,entry_opens_at,entry_closes_at,total_inventory,available,reserved,sold)
   VALUES ($1,'Closed-window test','ENTRY_CLOSED',now() - interval '2 hours',now() - interval '1 hour',500,500,0,0)`,
  [closedId],
);
console.log(JSON.stringify({ inventoryBalanced: true, rejectedInvalidInventory, rejectedDuplicateEntry, closedTestEventId: closedId }));
await db.close();
