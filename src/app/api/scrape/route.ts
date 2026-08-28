import { NextResponse } from "next/server";
import { client } from "@/lib/db";
import { ensureTables } from "@/lib/migrate";
import { findAndParseImpressum } from "@/lib/impressum";

export async function POST(req: Request) {
  await ensureTables();
  const body = await req.json().catch(() => ({}));
  const ids: number[] | undefined = body.ids;
  const limit = body.limit ? Math.min(Number(body.limit), 50) : 20;

  // select pending or explicitly requested
  let rows: any[];
  if (ids && Array.isArray(ids) && ids.length > 0) {
    const placeholders = ids.map(() => "?").join(",");
    const res = await client.execute({
      sql: `SELECT id, url FROM sites WHERE id IN (${placeholders})`,
      args: ids.map(String),
    });
    rows = res.rows as any[];
  } else {
    // pending first, then error, then oldest done re-scrape?
    const res = await client.execute({
      sql: `SELECT id, url FROM sites WHERE status IN ('pending','error') ORDER BY created_at ASC LIMIT ?`,
      args: [String(limit)],
    });
    rows = res.rows as any[];
    if (rows.length === 0) {
      // optionally allow re-scrape of done if ?force
      if (body.force) {
        const res2 = await client.execute({
          sql: `SELECT id, url FROM sites ORDER BY updated_at ASC LIMIT ?`,
          args: [String(limit)],
        });
        rows = res2.rows as any[];
      }
    }
  }

  if (rows.length === 0) {
    return NextResponse.json({ message: "Keine URLs zum Scrapen gefunden", count: 0 });
  }

  const results: any[] = [];

  for (const row of rows) {
    const id = row.id as number;
    const url = row.url as string;
    const now = new Date().toISOString();

    await client.execute({
      sql: `UPDATE sites SET status='scraping', updated_at=?, error=NULL WHERE id=?`,
      args: [now, String(id)],
    });

    try {
      const parsed = await findAndParseImpressum(url);

      // upsert impressum
      const existing = await client.execute({
        sql: `SELECT id FROM impressum WHERE site_id=?`,
        args: [String(id)],
      });

      if (existing.rows.length > 0) {
        await client.execute({
          sql: `UPDATE impressum SET impressum_url=?, raw_text=?, raw_html=?, company_name=?, legal_form=?, address=?, zip=?, city=?, country=?, managing_directors=?, register_court=?, register_number=?, ust_id=?, email=?, phone=?, fax=?, fetched_at=?, error=? WHERE site_id=?`,
          args: [
            parsed.impressumUrl,
            parsed.rawText,
            parsed.rawHtml,
            parsed.companyName,
            parsed.legalForm,
            parsed.address,
            parsed.zip,
            parsed.city,
            parsed.country,
            parsed.managingDirectors,
            parsed.registerCourt,
            parsed.registerNumber,
            parsed.ustId,
            parsed.email,
            parsed.phone,
            parsed.fax,
            now,
            parsed.error,
            String(id),
          ],
        });
      } else {
        await client.execute({
          sql: `INSERT INTO impressum (site_id, impressum_url, raw_text, raw_html, company_name, legal_form, address, zip, city, country, managing_directors, register_court, register_number, ust_id, email, phone, fax, fetched_at, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            String(id),
            parsed.impressumUrl,
            parsed.rawText,
            parsed.rawHtml,
            parsed.companyName,
            parsed.legalForm,
            parsed.address,
            parsed.zip,
            parsed.city,
            parsed.country,
            parsed.managingDirectors,
            parsed.registerCourt,
            parsed.registerNumber,
            parsed.ustId,
            parsed.email,
            parsed.phone,
            parsed.fax,
            now,
            parsed.error,
          ],
        });
      }

      const newStatus = parsed.error ? "error" : "done";
      await client.execute({
        sql: `UPDATE sites SET status=?, updated_at=?, error=? WHERE id=?`,
        args: [newStatus, now, parsed.error, String(id)],
      });

      results.push({ id, url, status: newStatus, impressumUrl: parsed.impressumUrl, error: parsed.error });
    } catch (e: any) {
      const err = e.message || String(e);
      await client.execute({
        sql: `UPDATE sites SET status='error', error=?, updated_at=? WHERE id=?`,
        args: [err, now, String(id)],
      });
      results.push({ id, url, status: "error", error: err });
    }
  }

  return NextResponse.json({ count: results.length, results });
}
