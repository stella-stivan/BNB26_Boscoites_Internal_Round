import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite(".data/pglite");
const buyers = (await db.query("SELECT id FROM demo_accounts WHERE role='buyer' ORDER BY display_name LIMIT 3")).rows;
if (buyers.length < 3) throw new Error("Three demo buyer accounts are required");
const fixtures = {};
for (const [name, ttl, admissions] of [["lastTicket", 30, 2], ["expiry", 2, 1], ["confirmExpiry", 3, 1]]) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO events (id,name,status,entry_opens_at,entry_closes_at,total_inventory,available,reserved,sold,batch_size,reservation_ttl_seconds,ordered_at,ordered_count)
     VALUES ($1,$2,'SELLING',now()-interval '2 hour',now()-interval '1 hour',1,1,0,0,2,$3,now(),$4)`,
    [id, `Phase 3 ${name}`, ttl, admissions],
  );
  for (let i = 0; i < admissions; i++) {
    await db.query(
      `INSERT INTO queue_entries (id,event_id,account_id,position,state,admitted_at,admission_expires_at)
       VALUES ($1,$2,$3,$4,'ADMITTED',now(),now()+interval '2 minute')`,
      [randomUUID(), id, buyers[i].id, i + 1],
    );
  }
  fixtures[name] = id;
}
console.log(JSON.stringify(fixtures));
await db.close();
