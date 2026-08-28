import { NextResponse } from "next/server";
import { client } from "@/lib/db";
import { ensureTables } from "@/lib/migrate";
import { normalizeUrlExport } from "@/lib/impressum";

function extractDomain(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // escaped quote?
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && (ch === "," || ch === ";")) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export async function POST(req: Request) {
  await ensureTables();
  const body = await req.json();
  let urls: string[] = [];
  // Quelle für diesen Import (optional)
  const importSource: string | null =
    (typeof body.source === "string" && body.source.trim()) ||
    (typeof body.quelle === "string" && body.quelle.trim()) ||
    null;

  if (Array.isArray(body.urls)) {
    urls = body.urls;
  } else if (typeof body.text === "string") {
    // pasted text / csv snippet
    urls = body.text.split(/[\n,;]+/);
  } else if (typeof body.sheetUrl === "string" && body.sheetUrl) {
    // server-side Google Sheet fetch
    const sheetUrl: string = body.sheetUrl.trim();

    // Helper: robust ID + gid extraction
    const extractSheetId = (u: string): string | null => {
      // published sheets: /spreadsheets/d/e/<pubId>
      const pub = u.match(/\/spreadsheets\/d\/e\/([a-zA-Z0-9-_]+)/);
      if (pub) return `e/${pub[1]}`;
      const m = u.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      return m ? m[1] : null;
    };
    const extractGid = (u: string): string => {
      try {
        const parsed = new URL(u);
        const gidParam = parsed.searchParams.get("gid");
        if (gidParam) return gidParam;
        // hash part like #gid=123
        const hashMatch = u.match(/[#&]gid=(\d+)/);
        if (hashMatch) return hashMatch[1];
      } catch {
        const hashMatch = u.match(/[#&]gid=(\d+)/);
        if (hashMatch) return hashMatch[1];
      }
      return "0";
    };

    const looksLikeExport = /export\?format=csv|output=csv|pub\?/.test(sheetUrl);
    let csvUrls: string[] = [];
    if (looksLikeExport) {
      csvUrls = [sheetUrl];
    } else {
      const id = extractSheetId(sheetUrl);
      if (!id) {
        // Fallback: falls es doch eine direkte CSV-URL ist (z.B. raw.githubusercontent), probiere direkten Fetch
        if (/^https?:\/\//i.test(sheetUrl)) {
          csvUrls = [sheetUrl];
        } else {
          return NextResponse.json(
            { error: `Ungültiger Google-Sheet-Link. Erwartet: https://docs.google.com/spreadsheets/d/<ID>/...` },
            { status: 400 }
          );
        }
      } else {
      const gid = extractGid(sheetUrl);
      if (id.startsWith("e/")) {
        // published
        csvUrls = [
          `https://docs.google.com/spreadsheets/d/${id}/pub?output=csv`,
          `https://docs.google.com/spreadsheets/d/${id}/pub?gid=${gid}&single=true&output=csv`,
        ];
      } else {
        csvUrls = [
          `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`,
          `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`,
          `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&gid=${gid}`,
        ];
      }
      }
    }

    let csvText: string | null = null;
    let lastErr = "";
    for (const csvUrl of csvUrls) {
      try {
        const r = await fetch(csvUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; Imprinta/1.0)",
            Accept: "text/csv,text/plain,*/*",
          },
          redirect: "follow",
        });
        if (!r.ok) {
          lastErr = `HTTP ${r.status} bei ${csvUrl}`;
          continue;
        }
        const text = await r.text();
        // Erkennung: Login/HTML statt CSV
        const trimmed = text.trimStart();
        if (
          trimmed.startsWith("<!DOCTYPE") ||
          trimmed.startsWith("<html") ||
          /<title>.*Google.*<\/title>/i.test(text.slice(0, 2000)) ||
          /accounts\.google\.com/i.test(text.slice(0, 3000))
        ) {
          // HTML statt CSV -> vermutlich nicht öffentlich
          if (text.includes("Sie benötigen") || text.includes("You need") || text.includes("Permission") || text.includes("Zugriff")) {
            lastErr = `Sheet nicht öffentlich (HTML-Login erhalten). Bitte Freigabe auf "Jeder mit Link – Betrachter" setzen.`;
          } else {
            lastErr = `Unerwartete HTML-Antwort statt CSV (Sheet evtl. nicht freigegeben).`;
          }
          continue;
        }
        // Leerer Inhalt?
        if (!text.trim()) {
          lastErr = `Leere Antwort von ${csvUrl}`;
          continue;
        }
        csvText = text;
        break;
      } catch (e: any) {
        lastErr = e.message || String(e);
      }
    }
    if (!csvText) {
      return NextResponse.json(
        {
          error: `Google Sheet konnte nicht geladen werden: ${lastErr}. Tipp: Sheet öffnen → Freigeben → "Jeder mit Link kann ansehen (Betrachter)" → Link erneut einfügen. Alternativ als CSV exportieren und per Datei-Upload importieren.`,
        },
        { status: 400 }
      );
    }
    // CSV parsen: erste Spalte = URL, Header tolerant
    const lines = csvText.split(/[\r\n]+/).filter((l) => l.trim() !== "");
    // Header erkennen
    let start = 0;
    if (lines[0] && /url|website|domain|webadresse|link/i.test(lines[0]) && !/https?:\/\//i.test(lines[0])) {
      start = 1;
    }
    urls = [];
    for (const line of lines.slice(start)) {
      // naive aber robust: split nach , oder ; und nimm erste nicht-leere Zelle, die wie URL aussieht
      // besser: Papaparse-ähnlich Anführungszeichen beachten
      const cells = splitCsvLine(line);
      let candidate = cells[0]?.trim().replace(/^"|"$/g, "") || "";
      // falls erste Zelle leer oder kein Punkt, probiere nächste Zellen
      if (!candidate.includes(".") && cells.length > 1) {
        for (let i = 1; i < cells.length; i++) {
          const c = cells[i].trim().replace(/^"|"$/g, "");
          if (c.includes(".") || /^https?:\/\//i.test(c)) {
            candidate = c;
            break;
          }
        }
      }
      if (candidate) urls.push(candidate);
    }
  } else {
    return NextResponse.json({ error: "urls[] oder text oder sheetUrl erforderlich" }, { status: 400 });
  }

  const cleaned = urls
    .map((u) => u.trim().replace(/^"|"$/g, ""))
    .filter((u) => u && (/^https?:\/\//i.test(u) || /^[a-z0-9.-]+\.[a-z]{2,}/i.test(u)))
    .map((u) => normalizeUrlExport(u))
    .filter((u) => {
      try {
        const host = new URL(u).hostname;
        return host.includes(".");
      } catch {
        return false;
      }
    });

  // deduplicate
  const unique = [...new Set(cleaned)];

  if (unique.length === 0) {
    return NextResponse.json(
      {
        error:
          "Keine gültigen URLs gefunden. Prüfe: (1) Sheet hat in Spalte A URLs mit http(s) oder Domain, (2) erste Zeile ist kein Header ohne URL, (3) Sheet ist auf 'Jeder mit Link – Betrachter' freigegeben.",
        attempted: 0,
      },
      { status: 400 }
    );
  }

  const beforeRes = await client.execute(`SELECT count(*) as c FROM sites`);
  const before = Number((beforeRes.rows[0] as any).c || 0);

  const errors: string[] = [];
  // Effektive Quelle: explizit gesetzte oder Fallback für Sheet
  const effectiveSource: string | null =
    importSource ||
    (typeof body.sheetUrl === "string" && body.sheetUrl.trim()
      ? body.sheetUrl.trim().slice(0, 200)
      : null) ||
    (typeof body.fileName === "string" && body.fileName.trim() ? body.fileName.trim().slice(0, 200) : null);

  for (const u of unique) {
    const domain = extractDomain(u);
    const now = new Date().toISOString();
    try {
      await client.execute({
        sql: `INSERT OR IGNORE INTO sites (url, original_url, domain, status, created_at, updated_at, source) VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
        args: [u, u, domain, now, now, effectiveSource],
      });
      // Falls URL bereits existierte und noch keine Quelle hat, nachträglich setzen
      if (effectiveSource) {
        await client.execute({
          sql: `UPDATE sites SET source = ?, updated_at = ? WHERE url = ? AND (source IS NULL OR source = '')`,
          args: [effectiveSource, now, u],
        });
      }
    } catch (e: any) {
      errors.push(`${u}: ${e.message}`);
    }
  }

  const countRes = await client.execute(`SELECT count(*) as c FROM sites`);
  const total = Number((countRes.rows[0] as any).c || 0);
  const inserted = total - before;

  return NextResponse.json({
    attempted: unique.length,
    inserted,
    total,
    errors,
    urls: unique.slice(0, 10),
  });
}
