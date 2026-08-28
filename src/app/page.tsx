"use client";

import { useEffect, useState, useCallback } from "react";

type Row = {
  id: number;
  url: string;
  domain: string | null;
  status: string;
  error: string | null;
  source: string | null;
  impressum_url: string | null;
  raw_text: string | null;
  company_name: string | null;
  address: string | null;
  zip: string | null;
  city: string | null;
  email: string | null;
  phone: string | null;
  ust_id: string | null;
  register_number: string | null;
  register_court: string | null;
  managing_directors: string | null;
};

export default function Home() {
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [sheetUrl, setSheetUrl] = useState("");
  const [filter, setFilter] = useState("");
  const [detail, setDetail] = useState<Row | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<25 | 50 | 100>(25);
  const [csvSource, setCsvSource] = useState("");
  const [sheetSource, setSheetSource] = useState("");
  const [editingSourceId, setEditingSourceId] = useState<number | null>(null);
  const [editingSourceVal, setEditingSourceVal] = useState("");
  const [detailSourceEdit, setDetailSourceEdit] = useState<string>("");

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/urls");
    const data = await r.json();
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const handleCsv = async (file: File) => {
    const text = await file.text();
    // quick parse: split lines, assume first col is url; header detection
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    // detect header: if first line contains no dot or contains "url" "website"
    let start = 0;
    if (lines[0] && /url|website|domain|webadresse/i.test(lines[0]) && !lines[0].includes(".")) {
      // still check if header looks like header without url
      // if first line has no http and no dot, skip
      if (!/^https?:\/\//i.test(lines[0]) && !lines[0].includes(".")) start = 1;
      else if (/^url/i.test(lines[0])) start = 1;
    }
    // papaparse alternative: just split by comma/semicolon and take first col
    const urls = lines.slice(start).map((l) => {
      // handle quoted csv
      const parts = l.split(/[,;]/);
      let v = parts[0].trim().replace(/^"|"$/g, "");
      // if second col looks more like url than first, use it
      if (parts.length > 1 && !v.includes(".") && parts[1].includes(".")) v = parts[1].trim().replace(/^"|"$/g, "");
      return v;
    });
    setImportLoading(true);
    const source = csvSource.trim() || file.name.replace(/\.csv$/i, "");
    const res = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls, source, fileName: file.name }),
    });
    const j = await res.json();
    setMsg(
      j.error
        ? `Fehler: ${j.error}`
        : `${j.attempted} URLs verarbeitet (Quelle: ${source || "—"}), Gesamt: ${j.total} · ${j.inserted} neu`
    );
    setImportLoading(false);
    fetchRows();
  };

  const handleSheet = async () => {
    if (!sheetUrl.trim()) return;
    setImportLoading(true);
    const source = sheetSource.trim() || sheetUrl.trim();
    const res = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sheetUrl, source }),
    });
    const j = await res.json();
    setMsg(
      j.error
        ? `Fehler: ${j.error}`
        : `${j.attempted} URLs aus Sheet importiert (Quelle: ${source.slice(0, 40)}), Gesamt: ${j.total} · ${j.inserted} neu`
    );
    setImportLoading(false);
    fetchRows();
  };

  const scrape = async (ids?: number[]) => {
    setLoading(true);
    setMsg("Scrape läuft …");
    const res = await fetch("/api/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ids ? { ids } : { limit: 20 }),
    });
    const j = await res.json();
    setMsg(j.message || `${j.count} Seiten gescraped`);
    await fetchRows();
    setLoading(false);
  };

  const toggle = (id: number) => {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setSelected(n);
  };

  const updateSource = async (id: number, source: string) => {
    const res = await fetch("/api/urls", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, source }),
    });
    if (res.ok) {
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, source: source || null } : r)));
      setDetail((d) => (d && d.id === id ? { ...d, source: source || null } : d));
    }
  };

  const filtered = rows.filter((r) => {
    if (!filter) return true;
    const f = filter.toLowerCase();
    return (
      r.url.toLowerCase().includes(f) ||
      (r.company_name && r.company_name.toLowerCase().includes(f)) ||
      (r.domain && r.domain.toLowerCase().includes(f)) ||
      r.status.toLowerCase().includes(f) ||
      (r.source && r.source.toLowerCase().includes(f))
    );
  });

  // pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * pageSize;
  const paginated = filtered.slice(startIdx, startIdx + pageSize);

  // reset page on filter / pageSize change
  useEffect(() => {
    setPage(1);
  }, [filter, pageSize, rows.length]);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [safePage, page]);

  useEffect(() => {
    if (detail) setDetailSourceEdit(detail.source || "");
    else setDetailSourceEdit("");
  }, [detail]);

  const allSelected = paginated.length > 0 && paginated.every((r) => selected.has(r.id));
  const someSelected = paginated.some((r) => selected.has(r.id));

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Imprinta</h1>
            <p className="text-sm text-zinc-500">CSV / Google Sheet → Turso → Impressum</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => fetchRows()}
              className="rounded-full border px-4 py-2 text-sm hover:bg-zinc-50"
            >
              Aktualisieren
            </button>
            <button
              onClick={async () => {
                if (!confirm("Alle Einträge löschen?")) return;
                await fetch("/api/urls?all=true", { method: "DELETE" });
                fetchRows();
              }}
              className="rounded-full bg-zinc-900 text-white px-4 py-2 text-sm hover:bg-zinc-800"
            >
              Alle löschen
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8 space-y-6">
        {/* Import Panel */}
        <section className="grid md:grid-cols-2 gap-6">
          <div className="rounded-2xl border bg-white p-5 space-y-4">
            <h2 className="font-medium">CSV importieren</h2>
            <p className="text-sm text-zinc-500">1 Spalte mit URLs (Header optional). Drag & Drop oder Datei wählen.</p>
            <div>
              <label className="text-xs font-medium text-zinc-600">Quelle (optional)</label>
              <input
                value={csvSource}
                onChange={(e) => setCsvSource(e.target.value)}
                placeholder="z.B. Kundenliste 2024, Lieferanten-CSV"
                className="mt-1 w-full rounded-full border px-4 py-2 text-sm"
              />
              <p className="text-[11px] text-zinc-400 mt-1">Wird für alle Zeilen dieses Imports gespeichert. Leer = Dateiname.</p>
            </div>
            <label className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed bg-zinc-50 p-6 cursor-pointer hover:bg-zinc-100">
              <span className="text-sm font-medium">CSV-Datei ablegen</span>
              <span className="text-xs text-zinc-500">.csv</span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleCsv(f);
                  e.target.value = "";
                }}
              />
            </label>
            {importLoading && <p className="text-sm text-zinc-500">Importiere …</p>}
          </div>

          <div className="rounded-2xl border bg-white p-5 space-y-4">
            <h2 className="font-medium">Google Sheet importieren</h2>
            <p className="text-sm text-zinc-500">Öffentlich freigegebenen Link einfügen (erste Spalte = URL).</p>
            <div>
              <label className="text-xs font-medium text-zinc-600">Quelle (optional)</label>
              <input
                value={sheetSource}
                onChange={(e) => setSheetSource(e.target.value)}
                placeholder="z.B. Kampagne Q1, Recherche-Sheet"
                className="mt-1 w-full rounded-full border px-4 py-2 text-sm"
              />
              <p className="text-[11px] text-zinc-400 mt-1">Leer = Link wird als Quelle gespeichert.</p>
            </div>
            <div className="flex gap-2">
              <input
                value={sheetUrl}
                onChange={(e) => setSheetUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/…"
                className="flex-1 rounded-full border px-4 py-2 text-sm"
              />
              <button
                onClick={handleSheet}
                disabled={importLoading || !sheetUrl}
                className="rounded-full bg-zinc-900 text-white px-5 py-2 text-sm disabled:opacity-50 hover:bg-zinc-800"
              >
                Import
              </button>
            </div>
            <p className="text-xs text-zinc-400">
              Sheet muss „Jeder mit Link – Betrachter“ sein. Wir testen 3 Export-Varianten und erkennen HTML-Login. Falls es trotzdem
              fehlschlägt, im Sheet auf <span className="font-medium">Datei → Herunterladen → CSV</span> und links per Datei-Upload importieren.
            </p>
          </div>
        </section>

        {msg && (
          <div className="rounded-xl bg-white border px-4 py-3 text-sm flex gap-3 items-start">
            <span className="flex-1 whitespace-pre-wrap break-words">{msg}</span>
            <button onClick={() => setMsg(null)} className="text-zinc-400 hover:text-zinc-600 shrink-0">
              ✕
            </button>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-3 items-center">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtern (Domain, Firma, Quelle, Status)…"
            className="rounded-full border bg-white px-4 py-2 text-sm w-64"
          />
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => scrape()}
              disabled={loading}
              className="rounded-full bg-black text-white px-5 py-2 text-sm disabled:opacity-50"
            >
              {loading ? "Läuft…" : "Alle Pending scrapen (20)"}
            </button>
            <button
              onClick={() => scrape(Array.from(selected))}
              disabled={selected.size === 0 || loading}
              className="rounded-full border bg-white px-5 py-2 text-sm disabled:opacity-50"
            >
              Auswahl scrapen ({selected.size})
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="rounded-2xl border bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-zinc-500">
                <tr>
                  <th className="p-3 text-left">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = !allSelected && someSelected;
                      }}
                      onChange={() => {
                        const next = new Set(selected);
                        if (allSelected) {
                          paginated.forEach((r) => next.delete(r.id));
                        } else {
                          paginated.forEach((r) => next.add(r.id));
                        }
                        setSelected(next);
                      }}
                      title={allSelected ? "Seite abwählen" : "Seite auswählen"}
                    />
                  </th>
                  <th className="p-3 text-left font-medium">URL / Domain</th>
                  <th className="p-3 text-left font-medium">Quelle</th>
                  <th className="p-3 text-left font-medium">Status</th>
                  <th className="p-3 text-left font-medium">Firma</th>
                  <th className="p-3 text-left font-medium">Kontakt</th>
                  <th className="p-3 text-left font-medium">Impressum</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-zinc-400">
                      Keine URLs vorhanden. Importiere eine CSV oder ein Google Sheet.
                    </td>
                  </tr>
                )}
                {paginated.map((r) => (
                  <tr key={r.id} className="hover:bg-zinc-50/60">
                    <td className="p-3">
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                    </td>
                    <td className="p-3">
                      <a href={r.url} target="_blank" className="font-medium hover:underline block max-w-[260px] truncate">
                        {r.url}
                      </a>
                      <span className="text-xs text-zinc-400">{r.domain}</span>
                    </td>
                    <td className="p-3">
                      {editingSourceId === r.id ? (
                        <div className="flex gap-1 items-center">
                          <input
                            value={editingSourceVal}
                            onChange={(e) => setEditingSourceVal(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                updateSource(r.id, editingSourceVal);
                                setEditingSourceId(null);
                              }
                              if (e.key === "Escape") setEditingSourceId(null);
                            }}
                            placeholder="Quelle"
                            className="w-32 rounded-full border px-2 py-1 text-xs"
                            autoFocus
                          />
                          <button
                            onClick={() => {
                              updateSource(r.id, editingSourceVal);
                              setEditingSourceId(null);
                            }}
                            className="rounded-full bg-zinc-900 text-white px-2 py-1 text-[11px]"
                          >
                            ✓
                          </button>
                          <button
                            onClick={() => setEditingSourceId(null)}
                            className="rounded-full border px-2 py-1 text-[11px]"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 group">
                          <span className="block max-w-[140px] truncate text-xs" title={r.source || ""}>
                            {r.source || <span className="text-zinc-400">—</span>}
                          </span>
                          <button
                            onClick={() => {
                              setEditingSourceId(r.id);
                              setEditingSourceVal(r.source || "");
                            }}
                            className="opacity-0 group-hover:opacity-100 rounded-full border px-1.5 py-0.5 text-[10px] hover:bg-zinc-50"
                            title="Quelle bearbeiten"
                          >
                            ✎
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                          r.status === "done"
                            ? "bg-green-100 text-green-700"
                            : r.status === "error"
                            ? "bg-red-100 text-red-700"
                            : r.status === "scraping"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-zinc-100 text-zinc-600"
                        }`}
                      >
                        {r.status}
                      </span>
                      {r.error && <span className="block text-xs text-red-500 mt-1 max-w-[180px] truncate">{r.error}</span>}
                    </td>
                    <td className="p-3">
                      <span className="block max-w-[180px] truncate">{r.company_name || "—"}</span>
                      <span className="text-xs text-zinc-500">{r.address ? `${r.zip || ""} ${r.city || ""}` : ""}</span>
                    </td>
                    <td className="p-3 text-xs">
                      <div className="truncate max-w-[160px]">{r.email || "—"}</div>
                      <div className="text-zinc-500">{r.phone || ""}</div>
                    </td>
                    <td className="p-3">
                      {r.impressum_url ? (
                        <a href={r.impressum_url} target="_blank" className="text-xs text-blue-600 hover:underline block max-w-[160px] truncate">
                          {r.impressum_url}
                        </a>
                      ) : (
                        <span className="text-xs text-zinc-400">—</span>
                      )}
                      {r.ust_id && <div className="text-xs text-zinc-500">{r.ust_id}</div>}
                    </td>
                    <td className="p-3 flex gap-1">
                      <button onClick={() => setDetail(r)} className="rounded-full border px-3 py-1 text-xs hover:bg-zinc-50">
                        Detail
                      </button>
                      <button
                        onClick={() => scrape([r.id])}
                        className="rounded-full bg-zinc-900 text-white px-3 py-1 text-xs"
                      >
                        Scan
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t bg-zinc-50 px-4 py-2 text-xs text-zinc-500 flex flex-wrap gap-2 items-center justify-between">
            <span>
              {filtered.length} / {rows.length} URLs · {rows.filter((r) => r.status === "done").length} done ·{" "}
              {rows.filter((r) => r.status === "pending").length} pending · {rows.filter((r) => r.status === "error").length} error
              {filtered.length > 0 && (
                <span className="ml-2">
                  · Zeige {startIdx + 1}–{Math.min(startIdx + pageSize, filtered.length)} von {filtered.length}
                </span>
              )}
            </span>
            {filtered.length > 0 && (
              <span className="text-zinc-400">
                {selected.size > 0 && `${selected.size} ausgewählt`}
                {selected.size > 0 && filtered.length !== selected.size && (
                  <button
                    onClick={() => setSelected(new Set(filtered.map((r) => r.id)))}
                    className="ml-2 underline hover:text-zinc-600"
                  >
                    alle {filtered.length} wählen
                  </button>
                )}
              </span>
            )}
          </div>
          {/* Pagination */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-white px-4 py-3">
            <div className="flex items-center gap-2 text-sm">
              <label className="text-zinc-500">Einträge pro Seite</label>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value) as 25 | 50 | 100)}
                className="rounded-full border bg-white px-3 py-1.5 text-sm"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                className="rounded-full border px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-zinc-50"
              >
                ← Zurück
              </button>

              <div className="flex items-center gap-1 mx-2">
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((p) => {
                    if (totalPages <= 7) return true;
                    if (p === 1 || p === totalPages) return true;
                    if (Math.abs(p - safePage) <= 1) return true;
                    if (safePage <= 3 && p <= 4) return true;
                    if (safePage >= totalPages - 2 && p >= totalPages - 3) return true;
                    return false;
                  })
                  .reduce<(number | string)[]>((acc, p, idx, arr) => {
                    if (idx > 0 && (p as number) - (arr[idx - 1] as number) > 1) acc.push("…");
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((p, idx) =>
                    p === "…" ? (
                      <span key={`e-${idx}`} className="px-1 text-zinc-400">
                        …
                      </span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => setPage(p as number)}
                        className={`min-w-8 rounded-full px-3 py-1.5 text-sm ${
                          p === safePage ? "bg-zinc-900 text-white" : "border hover:bg-zinc-50"
                        }`}
                      >
                        {p}
                      </button>
                    )
                  )}
              </div>

              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
                className="rounded-full border px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-zinc-50"
              >
                Weiter →
              </button>
            </div>

            <div className="text-xs text-zinc-400">
              Seite {safePage} von {totalPages}
            </div>
          </div>
        </div>

        <p className="text-xs text-zinc-400 text-center">
          Turso: setze <code>TURSO_DATABASE_URL</code> + <code>TURSO_AUTH_TOKEN</code> in <code>.env.local</code>. Ohne Env
          läuft lokal auf <code>file:local.db</code>.
        </p>
      </main>

      {detail && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetail(null)}>
          <div onClick={(e) => e.stopPropagation()} className="max-w-2xl w-full rounded-2xl bg-white p-6 space-y-4 max-h-[85vh] overflow-auto">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-semibold">{detail.company_name || detail.url}</h3>
                <a href={detail.url} target="_blank" className="text-sm text-blue-600 hover:underline">
                  {detail.url}
                </a>
              </div>
              <button onClick={() => setDetail(null)} className="rounded-full border px-3 py-1 text-sm">
                Schließen
              </button>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-zinc-500">Status</dt>
                <dd>{detail.status}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Quelle</dt>
                <dd className="flex gap-2 items-center">
                  <input
                    value={detailSourceEdit}
                    onChange={(e) => setDetailSourceEdit(e.target.value)}
                    placeholder="Quelle, z.B. Kundenliste"
                    className="flex-1 rounded-full border px-3 py-1 text-sm"
                  />
                  <button
                    onClick={async () => {
                      await updateSource(detail.id, detailSourceEdit);
                      setDetail((d) => (d ? { ...d, source: detailSourceEdit || null } : d));
                    }}
                    className="rounded-full bg-zinc-900 text-white px-3 py-1 text-xs"
                  >
                    Speichern
                  </button>
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">Impressum-URL</dt>
                <dd className="truncate">{detail.impressum_url || "—"}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Firma</dt>
                <dd>{detail.company_name || "—"}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Adresse</dt>
                <dd>{detail.address || "—"}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">PLZ / Ort</dt>
                <dd>
                  {detail.zip || ""} {detail.city || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">Geschäftsführer</dt>
                <dd>{detail.managing_directors || "—"}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Register</dt>
                <dd>
                  {detail.register_court || ""} {detail.register_number || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">USt-ID</dt>
                <dd>{detail.ust_id || "—"}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">E-Mail</dt>
                <dd>{detail.email || "—"}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Telefon</dt>
                <dd>{detail.phone || "—"}</dd>
              </div>
            </dl>
            <div>
              <h4 className="text-sm font-medium">Rohtext (Auszug)</h4>
              <pre className="mt-2 max-h-64 overflow-auto rounded-xl bg-zinc-50 p-3 text-xs whitespace-pre-wrap">
                {detail.raw_text ? detail.raw_text.slice(0, 4000) : "Kein Text vorhanden"}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
