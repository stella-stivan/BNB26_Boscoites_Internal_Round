import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite(".data/pglite");
const id = randomUUID();
await db.query(
  `INSERT INTO events (id,name,status,entry_opens_at,entry_closes_at,total_inventory,available,reserved,sold,batch_size,admission_ttl_seconds)
   VALUES ($1,'Phase 2 verification event','DRAFT',now() - interval '1 hour',now() + interval '1 hour',5,5,0,0,2,5)`,
  [id],
);
console.log(id);
await db.close();
