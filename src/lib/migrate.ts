import { client } from "./db";

export async function ensureTables() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL UNIQUE,
      original_url TEXT,
      domain TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      error TEXT,
      source TEXT
    )
  `);
  // Migration für bestehende DBs (falls Spalte noch fehlt)
  try {
    await client.execute(`ALTER TABLE sites ADD COLUMN source TEXT`);
  } catch {
    // Spalte existiert bereits
  }
  await client.execute(`
    CREATE TABLE IF NOT EXISTS impressum (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      impressum_url TEXT,
      raw_text TEXT,
      raw_html TEXT,
      company_name TEXT,
      legal_form TEXT,
      address TEXT,
      zip TEXT,
      city TEXT,
      country TEXT,
      managing_directors TEXT,
      register_court TEXT,
      register_number TEXT,
      ust_id TEXT,
      email TEXT,
      phone TEXT,
      fax TEXT,
      fetched_at TEXT,
      error TEXT
    )
  `);
  // index
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_sites_status ON sites(status)`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_sites_source ON sites(source)`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_impressum_site ON impressum(site_id)`);
}
