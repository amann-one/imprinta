# Imprinta – URL → Impressum Importer

Website-URLs mit Impressum-Daten anreichern via Scraper

Einfache Web-App: CSV oder Google Sheet mit Webadressen einlesen → in Turso speichern → Impressum finden und strukturierte Daten extrahieren.

## Stack
- Next.js 16 (App Router) + TypeScript + Tailwind
- Turso (libSQL) via `@libsql/client` + Drizzle
- Cheerio für HTML-Parsing, Fetch für Crawl (ohne Playwright)

## Features
- **CSV-Import**: Drag & Drop oder Datei wählen. Erste Spalte = URL, Header optional, `,` oder `;` als Trenner. Deduplizierung via `normalizeUrl`. Mit **Quelle**-Feld (z.B. „Kundenliste 2024“ – vorbelegt mit Dateiname, editierbar).
- **Google-Sheet-Import**: Öffentlichen Freigabe-Link einfügen (`Jeder mit Link kann ansehen`). Wird serverseitig via `https://docs.google.com/spreadsheets/d/ID/export?format=csv&gid=0` geholt. Mit **Quelle**-Feld (z.B. „Kampagne Q1“ – fallback Link).
- **Turso-Persistenz**: Tabelle `sites` + `impressum` (siehe `src/lib/schema.ts`). Auto-Migration beim ersten Request (`ensureTables`), inkl. `source` (Quelle) Spalte + `PATCH /api/urls` zum nachträglichen Editieren.
- **Impressum-Finder** (`src/lib/impressum.ts: findAndParseImpressum`):
  - Homepage fetch → Links mit `/impressum|imprint/i` suchen, Score nach Linktext + href + Footer/Header-Lage
  - Fallback: gängige Pfade `/impressum`, `/impressum.html`, `/imprint`, `/legal`, …
  - Seite fetchen → `extractMainText` (main/article/#content → body) → Heuristiken für E-Mail, Telefon, USt-ID (`DE\d{9}`), Handelsregister (HRB/HRA + Amtsgericht), Geschäftsführer, Adresse (PLZ-Ort)
  - Speichert `raw_text`, `raw_html` + strukturierte Felder
- **UI** (`src/app/page.tsx`): Filter (inkl. Quelle), Checkbox-Auswahl, „Alle Pending scrapen“ oder „Auswahl scrapen“, Detail-Modal (Quelle editierbar), Inline-Edit der Quelle in der Tabelle, Löschen, Pagination 25/50/100.

## Setup

```bash
npm install
```

`.env.local` anlegen (siehe `.env.example`):

```
TURSO_DATABASE_URL=libsql://your-db-xxx.turso.io
TURSO_AUTH_TOKEN=eyJ...
```

Ohne Env läuft lokal auf `file:local.db` (Fallback).

```bash
npm run dev    # http://localhost:3000
npm run build  # Prüfen
```

## API
- `GET /api/urls` – alle Sites + left joined Impressum (inkl. `source`)
- `DELETE /api/urls?id=1` oder `?all=true`
- `PATCH /api/urls` – Body `{ id: number, source: string }` zum Ändern der Quelle
- `POST /api/import` – Body `{ urls: string[] , source?: string }` oder `{ text: string }` oder `{ sheetUrl: string, source?: string , fileName?: string }` (Quelle wird in `sites.source` gespeichert, fallback Dateiname/Link)
- `POST /api/scrape` – Body `{ ids?: number[], limit?: number, force?: boolean }` – scraped max 50, default 20 pending

## Bekannte Limits
- Nur statisches HTML (Fetch/Cheerio). JS-gerenderte Impressen wie `heise.de` (templated) werden nicht erkannt – dafür bräuchte es Playwright (bewusst weggelassen per Abstimmung).
- Charset-Erkennung: fermentiert Umlaute bei manchen Seiten (z.B. ZEIT) – Inhalt bleibt lesbar, strukturierte Extraktion funktioniert dennoch.
- Rate-Limit / Bot-Schutz einzelner Seiten kann 403 liefern → Status `error`.

## Nächste Schritte (optional)
- Export als CSV/Excel
- OAuth für private Sheets
- Playwright-Fallback für JS-Seiten
- LLM-Extraktion für höhere Feld-Trefferquote
