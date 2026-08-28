import { NextResponse } from "next/server";
import { client } from "@/lib/db";
import { ensureTables } from "@/lib/migrate";

export async function GET() {
  await ensureTables();
  const res = await client.execute(`
    SELECT s.*, i.impressum_url, i.raw_text, i.company_name, i.legal_form, i.address, i.zip, i.city, i.email, i.phone, i.ust_id, i.register_number, i.register_court, i.managing_directors, i.fetched_at as impressum_fetched_at
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
  const source = typeof body.source === "string" ? body.source.trim().slice(0, 200) : null;
  // Quelle kann auch leer sein zum Löschen
  if (!id) return NextResponse.json({ error: "id erforderlich" }, { status: 400 });
  const now = new Date().toISOString();
  await client.execute({
    sql: `UPDATE sites SET source = ?, updated_at = ? WHERE id = ?`,
    args: [source, now, String(id)],
  });
  return NextResponse.json({ ok: true });
}
