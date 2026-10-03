import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cookies } from "next/headers";

const BUYER_COOKIE = "fd_buyer";
const ADMIN_COOKIE = "fd_admin";
const MAX_AGE = 60 * 60 * 24 * 7;

type SessionPayload = { sub: string; role: "buyer" | "organizer"; exp: number };
let secretPromise: Promise<string> | undefined;

async function sessionSecret() {
  secretPromise ??= (async () => {
    if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
    if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must be set in production");
    const file = path.join(process.cwd(), ".data", "session-secret");
    await mkdir(path.dirname(file), { recursive: true });
    try {
      return (await readFile(file, "utf8")).trim();
    } catch {
      const value = randomBytes(32).toString("hex");
      try {
        await writeFile(file, value, { flag: "wx" });
        return value;
      } catch {
        return (await readFile(file, "utf8")).trim();
      }
    }
  })();
  return secretPromise;
}

async function sign(payload: SessionPayload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", await sessionSecret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

async function verify(value: string | undefined): Promise<SessionPayload | null> {
  if (!value) return null;
  const [body, signature, extra] = value.split(".");
  if (!body || !signature || extra) return null;
  const expected = createHmac("sha256", await sessionSecret()).update(body).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (typeof payload.sub !== "string" || !["buyer", "organizer"].includes(payload.role) || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function buyerAccountId() {
  const store = await cookies();
  const session = await verify(store.get(BUYER_COOKIE)?.value);
  return session?.role === "buyer" ? session.sub : null;
}

export async function organizerSession() {
  const store = await cookies();
  const session = await verify(store.get(ADMIN_COOKIE)?.value);
  return session?.role === "organizer";
}

export async function setBuyerSession(accountId: string) {
  const store = await cookies();
  store.set(BUYER_COOKIE, await sign({ sub: accountId, role: "buyer", exp: Date.now() + MAX_AGE * 1000 }), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: MAX_AGE,
  });
}

export async function clearBuyerSession() {
  (await cookies()).delete(BUYER_COOKIE);
}

export async function privateHash(value: string) {
  return createHmac("sha256", await sessionSecret()).update(value).digest("hex");
}

export async function setOrganizerSession() {
  const store = await cookies();
  store.set(ADMIN_COOKIE, await sign({ sub: "organizer", role: "organizer", exp: Date.now() + MAX_AGE * 1000 }), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: MAX_AGE,
  });
}

export async function buyerCookieHeader(accountId: string) {
  return `${BUYER_COOKIE}=${await sign({ sub: accountId, role: "buyer", exp: Date.now() + MAX_AGE * 1000 })}`;
}

export async function organizerCookieHeader() {
  return `${ADMIN_COOKIE}=${await sign({ sub: "organizer", role: "organizer", exp: Date.now() + MAX_AGE * 1000 })}`;
}
