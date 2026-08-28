import { NextResponse } from "next/server";
import { client } from "@/lib/db";
import { ensureTables } from "@/lib/migrate";
import { normalizeUrlExport } from "@/lib/impressum";

export async function GET() {
  await ensureTables();
  const res = await client.execute(`
    SELECT s.*, i.impressum_url, i.raw_text, i.raw_html, i.company_name, i.legal_form, i.address, i.zip, i.city, i.country, i.email, i.phone, i.fax, i.ust_id, i.register_number, i.register_court, i.managing_directors, i.fetched_at as impressum_fetched_at, i.error as impressum_error
    FROM sites s
    LEFT JOIN impressum i ON i.site_id = s.id
    ORDER BY s.created_at DESC
    LIMIT 1000
  `);
  return NextResponse.json(res.rows);
}

export async function DELETE(req: Request) {
  await ensureTables();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const all = searchParams.get("all");
  if (all === "true") {
    await client.execute(`DELETE FROM impressum`);
    await client.execute(`DELETE FROM sites`);
    return NextResponse.json({ ok: true });
  }
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await client.execute({ sql: `DELETE FROM impressum WHERE site_id = ?`, args: [id] });
  await client.execute({ sql: `DELETE FROM sites WHERE id = ?`, args: [id] });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request) {
  await ensureTables();
  const body = await req.json().catch(() => ({}));
  const id = body.id;
  if (!id) return NextResponse.json({ error: "id erforderlich" }, { status: 400 });
  const now = new Date().toISOString();

  // 0) URL (sites.url) – falls geändert
  let urlChanged = false;
  if ("url" in body) {
    const rawUrl = typeof body.url === "string" ? body.url.trim() : "";
    if (!rawUrl) return NextResponse.json({ error: "URL darf nicht leer sein" }, { status: 400 });
    const normalized = normalizeUrlExport(rawUrl);
    try {
      const u = new URL(normalized);
      if (!u.hostname.includes(".")) throw new Error();
    } catch {
      return NextResponse.json({ error: "Ungültige URL" }, { status: 400 });
    }
    const dup = await client.execute({ sql: `SELECT id FROM sites WHERE url = ? AND id != ?`, args: [normalized, String(id)] });
    if (dup.rows.length > 0) return NextResponse.json({ error: "URL existiert bereits für einen anderen Eintrag" }, { status: 409 });
    const domain = (() => { try { return new URL(normalized).hostname; } catch { return null; } })();
    await client.execute({
      sql: `UPDATE sites SET url = ?, original_url = ?, domain = ?, status = 'pending', error = NULL, updated_at = ? WHERE id = ?`,
      args: [normalized, normalized, domain, now, String(id)],
    });
    urlChanged = true;
  }

  // Helper to pick field (camelCase or snake_case)
  const pick = (camel: string, snake: string) => {
    const v = body[camel] ?? body[snake];
    if (typeof v === "string") return v.trim().slice(0, 1000);
    if (v === null) return null;
    return undefined;
  };

  // 1) Quelle (sites.source) – falls im Body enthalten
  if ("source" in body || "quelle" in body) {
    const source = typeof body.source === "string" ? body.source.trim().slice(0, 200) : body.quelle != null ? String(body.quelle).trim().slice(0, 200) : null;
    // null/"" löscht Quelle
    const srcVal = source && source.length ? source : null;
    await client.execute({
      sql: `UPDATE sites SET source = ?, updated_at = ? WHERE id = ?`,
      args: [srcVal, now, String(id)],
    });
    // Falls nur source (und ggf. url) geschickt wurde, früh zurück wenn keine Impressum-Felder
    const hasImpressumKeys = [
      "impressum_url","impressumUrl","company_name","companyName","legal_form","legalForm",
      "address","zip","city","country","managing_directors","managingDirectors",
      "register_court","registerCourt","register_number","registerNumber","ust_id","ustId",
      "email","phone","fax","raw_text","rawText","raw_html","rawHtml"
    ].some((k) => k in body);
    if (!hasImpressumKeys && !urlChanged) return NextResponse.json({ ok: true });
    if (!hasImpressumKeys && urlChanged) return NextResponse.json({ ok: true });
  } else if (urlChanged) {
    // Nur URL geändert, keine weiteren Felder?
    const hasImpressumKeys = [
      "impressum_url","impressumUrl","company_name","companyName","legal_form","legalForm",
      "address","zip","city","country","managing_directors","managingDirectors",
      "register_court","registerCourt","register_number","registerNumber","ust_id","ustId",
      "email","phone","fax","raw_text","rawText","raw_html","rawHtml"
    ].some((k) => k in body);
    if (!hasImpressumKeys) return NextResponse.json({ ok: true });
  }

  // 2) Impressum-Felder (upsert)
  const fields: Record<string, string | null | undefined> = {
    impressum_url: pick("impressumUrl", "impressum_url"),
    company_name: pick("companyName", "company_name"),
    legal_form: pick("legalForm", "legal_form"),
    address: pick("address", "address"),
    zip: pick("zip", "zip"),
    city: pick("city", "city"),
    country: pick("country", "country"),
    managing_directors: pick("managingDirectors", "managing_directors"),
    register_court: pick("registerCourt", "register_court"),
    register_number: pick("registerNumber", "register_number"),
    ust_id: pick("ustId", "ust_id"),
    email: pick("email", "email"),
    phone: pick("phone", "phone"),
    fax: pick("fax", "fax"),
    raw_text: pick("rawText", "raw_text"),
    raw_html: pick("rawHtml", "raw_html"),
  };

  // Nur setzen wenn mindestens ein Feld explizit gesendet wurde
  const hasAny = Object.values(fields).some((v) => v !== undefined);
  if (hasAny) {
    const existing = await client.execute({ sql: `SELECT id FROM impressum WHERE site_id = ?`, args: [String(id)] });
    const toSet = Object.entries(fields).filter(([, v]) => v !== undefined) as [string, string | null][];
    if (existing.rows.length > 0) {
      if (toSet.length) {
        const setClause = toSet.map(([k]) => `${k} = ?`).join(", ");
        const vals = toSet.map(([, v]) => v as string | null);
        await client.execute({
          sql: `UPDATE impressum SET ${setClause}, fetched_at = ? WHERE site_id = ?`,
          args: [...vals, now, String(id)],
        });
      }
    } else {
      // INSERT – nur übergebene Felder + site_id
      const cols = ["site_id", ...toSet.map(([k]) => k), "fetched_at"];
      const placeholders = cols.map(() => "?").join(", ");
      const vals: (string | null)[] = [String(id), ...toSet.map(([, v]) => v as string | null), now];
      await client.execute({
        sql: `INSERT INTO impressum (${cols.join(", ")}) VALUES (${placeholders})`,
        args: vals,
      });
    }
    // Status auf done setzen wenn manuell editiert und vorher pending/error
    await client.execute({
      sql: `UPDATE sites SET status = CASE WHEN status IN ('pending','error') THEN 'done' ELSE status END, updated_at = ? WHERE id = ?`,
      args: [now, String(id)],
    });
  }

  return NextResponse.json({ ok: true });
}
