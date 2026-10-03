import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";

export type Queryable = {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
};
export type Database = Queryable & {
  transaction<T>(callback: (tx: Queryable) => Promise<T>): Promise<T>;
};

declare global {
  var fairDropDb: Promise<Database> | undefined;
}

async function initialize(): Promise<Database> {
  const schema = await readFile(path.join(process.cwd(), "db", "schema.sql"), "utf8");
  let db: Database;
  if (process.env.DATABASE_URL) {
    const { Pool } = await import("pg");
    const pool: Pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query(schema);
    db = {
      query: async <T>(sql: string, params?: unknown[]) => ({ rows: (await pool.query(sql, params)).rows as T[] }),
      transaction: async <T>(callback: (tx: Queryable) => Promise<T>) => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = await callback({ query: async <R>(sql: string, params?: unknown[]) => ({ rows: (await client.query(sql, params)).rows as R[] }) });
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      },
    };
  } else {
    if (process.env.NODE_ENV === "production" && process.env.VERCEL) {
      throw new Error("DATABASE_URL is required for hosted deployments.");
    }
    const { PGlite } = await import("@electric-sql/pglite");
    const dataDir = process.env.PGLITE_DATA_DIR ? path.resolve(process.env.PGLITE_DATA_DIR) : path.join(process.cwd(), ".data", "pglite");
    await mkdir(path.dirname(dataDir), { recursive: true });
    const local: PGlite = new PGlite(dataDir);
    await local.exec(schema);
    db = {
      query: async <T>(sql: string, params?: unknown[]) => ({ rows: (await local.query<T>(sql, params)).rows }),
      transaction: async <T>(callback: (tx: Queryable) => Promise<T>) => local.transaction(async (tx) =>
        callback({ query: async <R>(sql: string, params?: unknown[]) => ({ rows: (await tx.query<R>(sql, params)).rows }) })),
    };
  }
  await seed(db);
  return db;
}

async function seed(db: Database) {
  await db.query(
    "INSERT INTO demo_accounts (id, display_name, role) VALUES ($1, 'Organizer', 'organizer') ON CONFLICT (display_name) DO NOTHING",
    ["00000000-0000-4000-8000-000000000001"],
  );
  const existing = await db.query<{ id: string }>("SELECT id FROM events ORDER BY created_at,id LIMIT 1");
  if (existing.rows.length) {
    await db.query("INSERT INTO demo_current_event (singleton,event_id) VALUES (true,$1) ON CONFLICT (singleton) DO NOTHING", [existing.rows[0].id]);
    return;
  }
  const id = randomUUID();
  const opens = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const closes = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await db.query(
    `INSERT INTO events (id, name, status, entry_opens_at, entry_closes_at,
      total_inventory, available, reserved, sold, batch_size, reservation_ttl_seconds)
     VALUES ($1, $2, 'ENTRY_OPEN', $3, $4, 500, 500, 0, 0, 20, 300)`,
    [id, "Fair Drop demo sale", opens, closes],
  );
  await db.query("INSERT INTO demo_current_event (singleton,event_id) VALUES (true,$1) ON CONFLICT (singleton) DO UPDATE SET event_id=EXCLUDED.event_id", [id]);
  for (const name of ["Avery", "Blake", "Casey", "Devon", "Emery", "Finley"]) {
    await db.query(
      "INSERT INTO demo_accounts (id, display_name) VALUES ($1, $2) ON CONFLICT (display_name) DO NOTHING",
      [randomUUID(), name],
    );
  }
}

export function getDb(): Promise<Database> {
  globalThis.fairDropDb ??= initialize();
  return globalThis.fairDropDb;
}

export async function getSeedEventId(): Promise<string> {
  const db = await getDb();
  const result = await db.query<{ event_id: string }>("SELECT event_id FROM demo_current_event WHERE singleton=true");
  if (!result.rows[0]) throw new Error("No demo event is configured");
  return result.rows[0].event_id;
}
