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
  raw_html: string | null;
  company_name: string | null;
  legal_form: string | null;
  address: string | null;
  zip: string | null;
  city: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  fax: string | null;
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
  const [isEditingDetail, setIsEditingDetail] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Row>>({});
  const [savingDetail, setSavingDetail] = useState(false);

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

  const deleteOne = async (id: number) => {
    if (!confirm("Diesen Eintrag wirklich löschen? URL und Impressum-Daten werden entfernt.")) return;
    const res = await fetch(`/api/urls?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      setRows((prev) => prev.filter((r) => r.id !== id));
      setSelected((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
      if (detail?.id === id) setDetail(null);
      setMsg("Eintrag gelöscht");
    } else {
      const j = await res.json().catch(() => ({}));
      setMsg(`Fehler beim Löschen: ${j.error || res.statusText}`);
    }
  };

  const deleteSelected = async () => {
    if (selected.size === 0) return;
    if (!confirm(`${selected.size} Einträge wirklich löschen?`)) return;
    let ok = 0;
    for (const id of Array.from(selected)) {
      const res = await fetch(`/api/urls?id=${id}`, { method: "DELETE" });
      if (res.ok) ok++;
    }
    setRows((prev) => prev.filter((r) => !selected.has(r.id)));
    setSelected(new Set());
    setMsg(`${ok} Einträge gelöscht`);
    await fetchRows();
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

  const startEditingDetail = (row: Row) => {
    setEditForm({
      url: row.url || "",
      source: row.source || "",
      impressum_url: row.impressum_url || "",
      company_name: row.company_name || "",
      legal_form: row.legal_form || "",
      address: row.address || "",
      zip: row.zip || "",
      city: row.city || "",
      country: row.country || "",
      managing_directors: row.managing_directors || "",
      register_court: row.register_court || "",
      register_number: row.register_number || "",
      ust_id: row.ust_id || "",
      email: row.email || "",
      phone: row.phone || "",
      fax: row.fax || "",
      raw_text: row.raw_text || "",
    });
    setIsEditingDetail(true);
  };

  const saveDetail = async () => {
    if (!detail) return;
    setSavingDetail(true);
    const payload: any = { id: detail.id };
    // URL separat (wird normalisiert, Domain neu berechnet)
    if (editForm.url !== undefined) payload.url = editForm.url;
    // Quelle separat
    if (editForm.source !== undefined) payload.source = editForm.source;
    // Impressum-Felder – mappe Row-Felder zu API-Feldern (snake/camel beide ok)
    const map: Record<string, keyof Row> = {
      impressum_url: "impressum_url",
      company_name: "company_name",
      legal_form: "legal_form",
      address: "address",
      zip: "zip",
      city: "city",
      country: "country",
      managing_directors: "managing_directors",
      register_court: "register_court",
      register_number: "register_number",
      ust_id: "ust_id",
      email: "email",
      phone: "phone",
      fax: "fax",
      raw_text: "raw_text",
    };
    for (const [apiKey, rowKey] of Object.entries(map)) {
      const v = (editForm as any)[rowKey];
      if (v !== undefined) payload[apiKey] = v;
    }
    const res = await fetch("/api/urls", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      // Lokal updaten + neu laden
      setRows((prev) => prev.map((r) => (r.id === detail.id ? { ...r, ...editForm } as Row : r)));
      setDetail((d) => (d ? ({ ...d, ...editForm } as Row) : d));
      setIsEditingDetail(false);
      setMsg("Details gespeichert");
      await fetchRows();
    } else {
      const j = await res.json().catch(() => ({}));
      setMsg(`Fehler beim Speichern: ${j.error || res.statusText}`);
    }
    setSavingDetail(false);
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
    if (detail) {
      setDetailSourceEdit(detail.source || "");
      setIsEditingDetail(false);
      setEditForm({});
    } else {
      setDetailSourceEdit("");
      setIsEditingDetail(false);
      setEditForm({});
    }
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
            <button
              onClick={deleteSelected}
              disabled={selected.size === 0 || loading}
              className="rounded-full border border-red-200 text-red-600 bg-white px-5 py-2 text-sm disabled:opacity-50 hover:bg-red-50"
            >
              Auswahl löschen ({selected.size})
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="rounded-2xl border bg-white overflow-hidden flex flex-col min-w-0 max-w-full">
          <div className="overflow-x-auto w-full max-w-full overscroll-x-contain">
            <table className="w-full text-sm min-w-[820px]">
              <colgroup>
                <col style={{width: '36px'}} />
                <col style={{width: '22%'}} />
                <col style={{width: '150px'}} />
                <col style={{width: '23%'}} />
                <col style={{width: '12%'}} />
                <col style={{width: '15%'}} />
                <col style={{width: '140px'}} />
              </colgroup>
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
                  <th className="p-3 text-left font-medium" style={{width: '150px', minWidth: '150px', maxWidth: '150px'}}>Status</th>
                  <th className="p-3 text-left font-medium">Firma / Quelle</th>
                  <th className="p-3 text-left font-medium">Kontakt</th>
                  <th className="p-3 text-left font-medium">Impressum</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-zinc-400">
                      Keine URLs vorhanden. Importiere eine CSV oder ein Google Sheet.
                    </td>
                  </tr>
                )}
                {paginated.map((r) => (
                  <tr key={r.id} className="hover:bg-zinc-50/60">
                    <td className="p-3 overflow-hidden">
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                    </td>
                    <td className="p-3 overflow-hidden min-w-0">
                      <a href={r.url} target="_blank" className="font-medium hover:underline block w-full truncate" title={r.url}>
                        {r.url}
                      </a>
                      <span className="text-xs text-zinc-400 block truncate w-full" title={r.domain || ""}>{r.domain}</span>
                    </td>
                    <td className="p-3 overflow-visible" style={{width: '150px', minWidth: '150px', maxWidth: '150px'}}>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium truncate max-w-[110px] ${
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
                        {r.error && (
                          <div className="relative group shrink-0">
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-100 text-red-600 text-[11px] font-bold cursor-help">!</span>
                            <div className="pointer-events-none absolute left-1/2 top-full z-50 hidden -translate-x-1/2 group-hover:block pt-2">
                              <div className="min-w-[220px] max-w-[320px] rounded-xl border bg-white p-3 shadow-lg">
                                <div className="text-xs font-medium text-red-600 mb-1">Fehler</div>
                                <div className="text-xs text-zinc-700 break-words whitespace-normal">{r.error}</div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="p-3 overflow-hidden min-w-0">
                      <span className="block w-full truncate font-medium" title={r.company_name || ""}>{r.company_name || "—"}</span>
                      {editingSourceId === r.id ? (
                        <div className="flex gap-1 items-center min-w-0 mt-1">
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
                            className="w-full min-w-0 max-w-[140px] rounded-full border px-2 py-1 text-xs"
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
                        <div className="flex items-center gap-1 group min-w-0 overflow-hidden mt-1">
                          <span className="block w-full truncate text-xs text-zinc-500" title={r.source || ""}>
                            {r.source ? `Quelle: ${r.source}` : <span className="text-zinc-400">—</span>}
                          </span>
                          <button
                            onClick={() => {
                              setEditingSourceId(r.id);
                              setEditingSourceVal(r.source || "");
                            }}
                            className="opacity-0 group-hover:opacity-100 rounded-full border px-1.5 py-0.5 text-[10px] hover:bg-zinc-50 shrink-0"
                            title="Quelle bearbeiten"
                          >
                            ✎
                          </button>
                        </div>
                      )}
                      <span className="text-xs text-zinc-500 block w-full truncate mt-1" title={r.address ? `${r.zip || ""} ${r.city || ""}` : ""}>{r.address ? `${r.zip || ""} ${r.city || ""}` : ""}</span>
                    </td>
                    <td className="p-3 text-xs overflow-hidden min-w-0">
                      <div className="truncate w-full" title={r.email || ""}>{r.email || "—"}</div>
                      <div className="text-zinc-500 truncate w-full" title={r.phone || ""}>{r.phone || ""}</div>
                    </td>
                    <td className="p-3 overflow-hidden min-w-0">
                      {r.impressum_url ? (
                        <a href={r.impressum_url} target="_blank" className="text-xs text-blue-600 hover:underline block w-full truncate" title={r.impressum_url}>
                          {r.impressum_url}
                        </a>
                      ) : (
                        <span className="text-xs text-zinc-400">—</span>
                      )}
                      {r.ust_id && <div className="text-xs text-zinc-500 w-full truncate" title={r.ust_id}>{r.ust_id}</div>}
                    </td>
                    <td className="p-3 overflow-hidden">
                      <div className="flex gap-1 flex-nowrap min-w-0">
                      <button onClick={() => setDetail(r)} className="rounded-full border px-2.5 py-1 text-xs hover:bg-zinc-50" title="Details ansehen/bearbeiten">
                        Detail
                      </button>
                      <button
                        onClick={() => scrape([r.id])}
                        className="rounded-full bg-zinc-900 text-white px-2.5 py-1 text-xs"
                        title="Erneut scrapen"
                      >
                        Scan
                      </button>
                      <button
                        onClick={() => deleteOne(r.id)}
                        className="rounded-full border border-red-200 text-red-600 px-2.5 py-1 text-xs hover:bg-red-50"
                        title="Eintrag löschen"
                      >
                        Löschen
                      </button>
                      </div>
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
            <div className="flex justify-between items-start gap-4">
              <div className="min-w-0">
                <h3 className="font-semibold truncate">{isEditingDetail ? (editForm.company_name || detail.url) : (detail.company_name || detail.url)}</h3>
                <a href={detail.url} target="_blank" className="text-sm text-blue-600 hover:underline break-all">
                  {detail.url}
                </a>
                <div className="text-xs text-zinc-500 mt-1">Status: {detail.status} {detail.error ? `· ${detail.error}` : ""}</div>
              </div>
              <div className="flex gap-2 shrink-0">
                {!isEditingDetail ? (
                  <>
                    <button
                      onClick={() => startEditingDetail(detail)}
                      className="rounded-full bg-zinc-900 text-white px-4 py-1.5 text-sm"
                    >
                      Bearbeiten
                    </button>
                    <button
                      onClick={() => deleteOne(detail.id)}
                      className="rounded-full border border-red-200 text-red-600 px-4 py-1.5 text-sm hover:bg-red-50"
                    >
                      Löschen
                    </button>
                    <button onClick={() => setDetail(null)} className="rounded-full border px-3 py-1.5 text-sm">
                      Schließen
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setIsEditingDetail(false)}
                      className="rounded-full border px-4 py-1.5 text-sm"
                      disabled={savingDetail}
                    >
                      Abbrechen
                    </button>
                    <button
                      onClick={saveDetail}
                      disabled={savingDetail}
                      className="rounded-full bg-zinc-900 text-white px-4 py-1.5 text-sm disabled:opacity-50"
                    >
                      {savingDetail ? "Speichert…" : "Speichern"}
                    </button>
                  </>
                )}
              </div>
            </div>

            {!isEditingDetail ? (
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-zinc-500">Quelle</dt>
                  <dd className="break-words">{detail.source || "—"}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Impressum-URL</dt>
                  <dd className="break-all truncate" title={detail.impressum_url || ""}>{detail.impressum_url || "—"}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Firma</dt>
                  <dd className="break-words">{detail.company_name || "—"}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Rechtsform</dt>
                  <dd>{detail.legal_form || "—"}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-zinc-500">Adresse</dt>
                  <dd className="break-words">{detail.address || "—"}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">PLZ</dt>
                  <dd>{detail.zip || "—"}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Ort</dt>
                  <dd>{detail.city || "—"}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Land</dt>
                  <dd>{detail.country || "—"}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Geschäftsführer</dt>
                  <dd className="break-words">{detail.managing_directors || "—"}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Registergericht</dt>
                  <dd className="break-words">{detail.register_court || "—"}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Registernummer</dt>
                  <dd>{detail.register_number || "—"}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">USt-ID</dt>
                  <dd className="break-all">{detail.ust_id || "—"}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">E-Mail</dt>
                  <dd className="break-all">{detail.email || "—"}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Telefon</dt>
                  <dd>{detail.phone || "—"}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Fax</dt>
                  <dd>{detail.fax || "—"}</dd>
                </div>
              </dl>
            ) : (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <label className="col-span-2">
                  <span className="text-xs text-zinc-500">URL (ursprüngliche Webadresse) *</span>
                  <input value={editForm.url || ""} onChange={(e) => setEditForm((p) => ({ ...p, url: e.target.value }))} placeholder="https://beispiel.de" className="mt-1 w-full rounded-full border px-3 py-2 text-sm" />
                  <span className="text-[11px] text-zinc-400">Wird normalisiert, Domain neu berechnet. Duplikate werden abgelehnt.</span>
                </label>
                <label className="col-span-2">
                  <span className="text-xs text-zinc-500">Quelle</span>
                  <input value={editForm.source || ""} onChange={(e) => setEditForm((p) => ({ ...p, source: e.target.value }))} placeholder="Quelle" className="mt-1 w-full rounded-full border px-3 py-2 text-sm" />
                </label>
                <label className="col-span-2">
                  <span className="text-xs text-zinc-500">Impressum-URL</span>
                  <input value={editForm.impressum_url || ""} onChange={(e) => setEditForm((p) => ({ ...p, impressum_url: e.target.value }))} placeholder="https://..." className="mt-1 w-full rounded-full border px-3 py-2 text-sm" />
                </label>
                <label>
                  <span className="text-xs text-zinc-500">Firma</span>
                  <input value={editForm.company_name || ""} onChange={(e) => setEditForm((p) => ({ ...p, company_name: e.target.value }))} className="mt-1 w-full rounded-full border px-3 py-2 text-sm" />
                </label>
                <label>
                  <span className="text-xs text-zinc-500">Rechtsform</span>
                  <input value={editForm.legal_form || ""} onChange={(e) => setEditForm((p) => ({ ...p, legal_form: e.target.value }))} placeholder="GmbH, UG..." className="mt-1 w-full rounded-full border px-3 py-2 text-sm" />
                </label>
                <label className="col-span-2">
                  <span className="text-xs text-zinc-500">Adresse</span>
                  <input value={editForm.address || ""} onChange={(e) => setEditForm((p) => ({ ...p, address: e.target.value }))} placeholder="Straße, Nr." className="mt-1 w-full rounded-full border px-3 py-2 text-sm" />
                </label>
                <label>
                  <span className="text-xs text-zinc-500">PLZ</span>
                  <input value={editForm.zip || ""} onChange={(e) => setEditForm((p) => ({ ...p, zip: e.target.value }))} className="mt-1 w-full rounded-full border px-3 py-2 text-sm" />
                </label>
                <label>
                  <span className="text-xs text-zinc-500">Ort</span>
                  <input value={editForm.city || ""} onChange={(e) => setEditForm((p) => ({ ...p, city: e.target.value }))} className="mt-1 w-full rounded-full border px-3 py-2 text-sm" />
                </label>
                <label>
                  <span className="text-xs text-zinc-500">Land</span>
                  <input value={editForm.country || ""} onChange={(e) => setEditForm((p) => ({ ...p, country: e.target.value }))} placeholder="DE" className="mt-1 w-full rounded-full border px-3 py-2 text-sm" />
                </label>
                <label>
                  <span className="text-xs text-zinc-500">Geschäftsführer</span>
                  <input value={editForm.managing_directors || ""} onChange={(e) => setEditForm((p) => ({ ...p, managing_directors: e.target.value }))} className="mt-1 w-full rounded-full border px-3 py-2 text-sm" />
                </label>
                <label>
                  <span className="text-xs text-zinc-500">Registergericht</span>
                  <input value={editForm.register_court || ""} onChange={(e) => setEditForm((p) => ({ ...p, register_court: e.target.value }))} className="mt-1 w-full rounded-full border px-3 py-2 text-sm" />
                </label>
                <label>
                  <span className="text-xs text-zinc-500">Registernummer</span>
                  <input value={editForm.register_number || ""} onChange={(e) => setEditForm((p) => ({ ...p, register_number: e.target.value }))} placeholder="HRB 1234" className="mt-1 w-full rounded-full border px-3 py-2 text-sm" />
                </label>
                <label>
                  <span className="text-xs text-zinc-500">USt-ID</span>
                  <input value={editForm.ust_id || ""} onChange={(e) => setEditForm((p) => ({ ...p, ust_id: e.target.value }))} placeholder="DE123456789" className="mt-1 w-full rounded-full border px-3 py-2 text-sm" />
                </label>
                <label>
                  <span className="text-xs text-zinc-500">E-Mail</span>
                  <input value={editForm.email || ""} onChange={(e) => setEditForm((p) => ({ ...p, email: e.target.value }))} className="mt-1 w-full rounded-full border px-3 py-2 text-sm" />
                </label>
                <label>
                  <span className="text-xs text-zinc-500">Telefon</span>
                  <input value={editForm.phone || ""} onChange={(e) => setEditForm((p) => ({ ...p, phone: e.target.value }))} className="mt-1 w-full rounded-full border px-3 py-2 text-sm" />
                </label>
                <label>
                  <span className="text-xs text-zinc-500">Fax</span>
                  <input value={editForm.fax || ""} onChange={(e) => setEditForm((p) => ({ ...p, fax: e.target.value }))} className="mt-1 w-full rounded-full border px-3 py-2 text-sm" />
                </label>
                <label className="col-span-2">
                  <span className="text-xs text-zinc-500">Rohtext (editierbar)</span>
                  <textarea value={editForm.raw_text || ""} onChange={(e) => setEditForm((p) => ({ ...p, raw_text: e.target.value }))} rows={4} className="mt-1 w-full rounded-2xl border px-3 py-2 text-sm" placeholder="Impressum-Rohtext" />
                </label>
              </div>
            )}

            <div>
              <h4 className="text-sm font-medium">Rohtext (Auszug) {isEditingDetail && <span className="text-xs text-zinc-400">– oben editierbar</span>}</h4>
              <pre className="mt-2 max-h-64 overflow-auto rounded-xl bg-zinc-50 p-3 text-xs whitespace-pre-wrap break-words">
                {isEditingDetail ? (editForm.raw_text || detail.raw_text || "Kein Text vorhanden").slice(0, 4000) : (detail.raw_text ? detail.raw_text.slice(0, 4000) : "Kein Text vorhanden")}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
