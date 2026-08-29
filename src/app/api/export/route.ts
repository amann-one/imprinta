import { NextRequest, NextResponse } from "next/server";
import { client } from "@/lib/db";
import { ensureTables } from "@/lib/migrate";
import * as XLSX from "xlsx";

const HEADERS = [
  { key: "url", label: "Website-URL" },
  { key: "domain", label: "Domain" },
  { key: "source", label: "Quelle" },
  { key: "status", label: "Status" },
  { key: "company_name", label: "Firma" },
  { key: "legal_form", label: "Rechtsform" },
  { key: "address", label: "Adresse" },
  { key: "zip", label: "PLZ" },
  { key: "city", label: "Ort" },
  { key: "country", label: "Land" },
  { key: "managing_directors", label: "Geschäftsführer" },
  { key: "register_court", label: "Registergericht" },
  { key: "register_number", label: "Registernummer" },
  { key: "ust_id", label: "USt-ID" },
  { key: "email", label: "E-Mail" },
  { key: "phone", label: "Telefon" },
  { key: "fax", label: "Fax" },
  { key: "impressum_url", label: "Impressum-URL" },
  { key: "impressum_fetched_at", label: "Abgerufen am" },
];

function csvEscape(v: any): string {
  if (v == null) return "";
  const s = String(v).replace(/"/g, '""');
  if (/[",\n;]/.test(s)) return `"${s}"`;
  return s;
}

export async function GET(req: NextRequest) {
  await ensureTables();
  const { searchParams } = new URL(req.url);
  const format = (searchParams.get("format") || "csv").toLowerCase();
  const status = searchParams.get("status") || "done"; // done | all | pending | error
  const source = searchParams.get("source") || "";

  let where = "";
  const args: string[] = [];
  if (status !== "all") {
    where = "WHERE s.status = ?";
    args.push(status);
  }
  if (source) {
    where += where ? " AND s.source = ?" : "WHERE s.source = ?";
    args.push(source);
  }

  const sql = `
    SELECT s.url, s.domain, s.source, s.status, s.error as site_error,
           i.impressum_url, i.company_name, i.legal_form, i.address, i.zip, i.city, i.country,
           i.managing_directors, i.register_court, i.register_number, i.ust_id, i.email, i.phone, i.fax,
           i.fetched_at as impressum_fetched_at
    FROM sites s
    LEFT JOIN impressum i ON i.site_id = s.id
    ${where}
    ORDER BY s.created_at DESC
    LIMIT 2000
  `;

  const res = await client.execute({ sql, args });
  const rows = res.rows as any[];

  if (format === "xlsx" || format === "xls") {
    const data = [
      HEADERS.map((h) => h.label),
      ...rows.map((r) => HEADERS.map((h) => r[h.key] ?? "")),
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    // Spaltenbreiten
    ws["!cols"] = HEADERS.map((h) => {
      if (h.key === "url" || h.key === "impressum_url") return { wch: 36 };
      if (h.key === "email") return { wch: 24 };
      if (h.key === "company_name") return { wch: 28 };
      if (h.key === "address") return { wch: 24 };
      return { wch: 16 };
    });
    // Header fett
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
      if (cell) {
        cell.s = {
          font: { bold: true, color: { rgb: "FFFFFF" } },
          fill: { fgColor: { rgb: "18181B" } },
          alignment: { horizontal: "center", vertical: "center" },
        };
      }
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Imprinta Export");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as unknown as Uint8Array;
    const filename = `imprinta-export-${status}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    return new NextResponse(buf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // CSV
  const header = HEADERS.map((h) => csvEscape(h.label)).join(";");
  const lines = rows.map((r) => HEADERS.map((h) => csvEscape(r[h.key])).join(";"));
  const csv = [header, ...lines].join("\r\n");
  // BOM für Excel
  const bom = "\uFEFF";
  const filename = `imprinta-export-${status}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(bom + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
