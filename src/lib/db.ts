import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url) {
  console.warn("[db] TURSO_DATABASE_URL not set – using file:local.db (dev fallback)");
}

const client = createClient({
  url: url || "file:local.db",
  authToken: authToken,
});

export const db = drizzle(client);
export { client };
