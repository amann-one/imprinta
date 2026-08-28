import * as cheerio from "cheerio";

export type ParsedImpressum = {
  impressumUrl: string | null;
  rawText: string | null;
  rawHtml: string | null;
  companyName: string | null;
  legalForm: string | null;
  address: string | null;
  zip: string | null;
  city: string | null;
  country: string | null;
  managingDirectors: string | null;
  registerCourt: string | null;
  registerNumber: string | null;
  ustId: string | null;
  email: string | null;
  phone: string | null;
  fax: string | null;
  error: string | null;
};

const IMPRESSUM_LINK_TEXT = /impressum|imprint|anbieterkennzeichnung|kontakt.*impressum/i;
const IMPRESSUM_HREF = /impressum|imprint|anbieterkennzeichnung|legal|pflichtangaben/i;

const COMMON_PATHS = [
  "/impressum",
  "/imprint",
  "/impressum.html",
  "/imprint.html",
  "/legal",
  "/legal-notice",
  "/anbieterkennzeichnung",
  "/kontakt/impressum",
  "/de/impressum",
  "/en/imprint",
];

function normalizeUrl(input: string): string {
  let u = input.trim();
  if (!u) return u;
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  try {
    const parsed = new URL(u);
    parsed.hash = "";
    // remove trailing slash except root
    let href = parsed.toString();
    if (href.endsWith("/") && parsed.pathname !== "/") href = href.slice(0, -1);
    return href;
  } catch {
    return u;
  }
}

function toAbsolute(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

async function fetchHtml(url: string, timeoutMs = 12000): Promise<{ html: string; finalUrl: string } | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; Imprinta/1.0; +https://imprinta.app/bot)",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
      },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html") && !ct.includes("application/xhtml") && !ct.includes("text/plain")) {
      // trotzdem versuchen
    }
    const html = await res.text();
    return { html, finalUrl: res.url || url };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function findImpressumLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const candidates: { url: string; score: number }[] = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const text = $(el).text().trim();
    const hrefLower = href.toLowerCase();
    const textLower = text.toLowerCase();

    let score = 0;
    if (IMPRESSUM_LINK_TEXT.test(text)) score += 10;
    if (IMPRESSUM_HREF.test(hrefLower)) score += 8;
    if (textLower === "impressum" || textLower === "imprint") score += 5;
    // footer / header links höher werten
    const parent = $(el).parents("footer, header, nav").length ? 2 : 0;
    score += parent;

    if (score > 0) {
      const abs = toAbsolute(href, baseUrl);
      if (abs) {
        // nur gleiche Domain
        try {
          const baseHost = new URL(baseUrl).hostname;
          const candHost = new URL(abs).hostname;
          if (baseHost === candHost || candHost.endsWith("." + baseHost) || baseHost.endsWith("." + candHost)) {
            // ok
          } else {
            // dennoch erlauben falls extern aber score hoch? skip
            return;
          }
        } catch {}
        candidates.push({ url: abs, score });
      }
    }
  });

  // deduplicate
  const seen = new Set<string>();
  const sorted = candidates
    .sort((a, b) => b.score - a.score)
    .filter((c) => {
      if (seen.has(c.url)) return false;
      seen.add(c.url);
      return true;
    })
    .map((c) => c.url);

  return sorted.slice(0, 5);
}

function extractMainText(html: string): { text: string; html: string } {
  const $ = cheerio.load(html);
  $("script, style, noscript, iframe, svg, canvas").remove();
  // häufige Störbereiche entfernen aber nicht zu aggressiv
  // versuche main content
  let content =
    $("main").html() ||
    $("article").html() ||
    $("#content").html() ||
    $(".content").html() ||
    $("#main").html() ||
    $("body").html() ||
    "";

  const $c = cheerio.load(`<div>${content}</div>`);
  $c("nav, header, footer").remove();
  // br zu newline
  $c("br").replaceWith("\n");
  $c("p, div, h1, h2, h3, h4, li, tr").each((_, el) => {
    const $el = $c(el);
    $el.prepend("\n");
    $el.append("\n");
  });
  const text = $c.text().replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
  const rawHtml = content.slice(0, 50000); // limit
  return { text, html: rawHtml };
}

function parseStructuredFields(text: string): Partial<ParsedImpressum> {
  const result: Partial<ParsedImpressum> = {};
  if (!text) return result;

  // E-Mail
  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (emailMatch) result.email = emailMatch[0];

  // Telefon
  // sucht nach Tel./Telefon/ Fon mit Nummer
  const phoneRegex =
    /(?:Tel(?:efon)?|Phone|Fon)\s*[:.]?\s*(\+?[\d\s/().-]{6,}\d)/i;
  const phoneM = text.match(phoneRegex);
  if (phoneM) {
    result.phone = phoneM[1].trim();
  } else {
    // fallback: erste internationale Nummer
    const genericPhone = text.match(/\+49[\d\s/().-]{6,}\d/);
    if (genericPhone) result.phone = genericPhone[0].trim();
  }

  // Fax
  const faxM = text.match(/Fax\s*[:.]?\s*(\+?[\d\s/().-]{6,}\d)/i);
  if (faxM) result.fax = faxM[1].trim();

  // USt-ID
  const ustM = text.match(/USt[-\s]*IdNr\.?|Umsatzsteuer[-\s]*Identifikationsnummer|USt-IdNr/i);
  if (ustM) {
    const ustVal = text.match(/DE\s*\d{9}/);
    if (ustVal) result.ustId = ustVal[0].replace(/\s+/g, "");
  } else {
    const ustDirect = text.match(/DE\s*\d{9}/);
    if (ustDirect) result.ustId = ustDirect[0].replace(/\s+/g, "");
  }

  // Handelsregister
  // z.B. Amtsgericht München, HRB 123456  oder Handelsregister: HRB 1234
  const hrCourt = text.match(/Amtsgericht\s+([A-Za-zÄÖÜäöüß\s-]+)/i);
  if (hrCourt) result.registerCourt = hrCourt[1].trim().split("\n")[0].trim();
  const hrNumber = text.match(/\b(HRB|HRA)\s*(\d+[A-Za-z]*)/i);
  if (hrNumber) result.registerNumber = `${hrNumber[1].toUpperCase()} ${hrNumber[2]}`;

  // Geschäftsführer / Vertreten durch / Verantwortlich
  const gfMatch = text.match(
    /(?:Geschäftsführer|Geschäftsführung|Vertreten durch|Geschäftsführerin|Inhaber|Inhaberin)\s*[:\-]\s*([^\n]{3,80})/i
  );
  if (gfMatch) result.managingDirectors = gfMatch[1].trim();

  // Adresse – suche PLZ + Ort
  // DE PLZ 5-stellig, AT 4-stellig; wir nehmen 4-5
  const addrMatch = text.match(/(\b\d{4,5}\b)\s+([A-Za-zÄÖÜäöüß\s.-]{2,40})/);
  if (addrMatch) {
    result.zip = addrMatch[1];
    result.city = addrMatch[2].split("\n")[0].trim();
    // versuche Straße davor zu finden
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const idx = lines.findIndex((l) => l.includes(addrMatch[0]));
    if (idx > 0) {
      const prev = lines[idx - 1];
      // Straße enthält oft Zahl und "str."/"Str"/"Weg" etc.
      if (/\d/.test(prev) || /str\.|straße|weg|allee|platz|gasse/i.test(prev)) {
        result.address = `${prev}, ${addrMatch[0]}`;
      } else {
        result.address = addrMatch[0];
      }
    } else {
      result.address = addrMatch[0];
    }
  }

  // Firmenname – erste Zeile die wie Firma aussieht vor Adresse?
  // Heuristik: nimm erste Zeile mit GmbH, UG, AG, e.V., GbR etc.
  const companyRe = /^.*\b(GmbH|UG|AG|e\.V\.|GbR|KG|OHG|GmbH & Co\. KG|gGmbH)\b.*$/im;
  const compM = text.match(companyRe);
  if (compM) result.companyName = compM[0].trim().slice(0, 200);
  else {
    // fallback: erste nicht-leere Zeile die nicht "Impressum" ist
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const first = lines.find((l) => l.length > 3 && !/^impressum$/i.test(l));
    if (first && first.length < 80) result.companyName = first;
  }

  // Rechtsform aus Firmenname
  if (result.companyName) {
    const rf = result.companyName.match(/\b(GmbH|UG|AG|e\.V\.|GbR|KG|OHG|gGmbH)\b/i);
    if (rf) result.legalForm = rf[1];
  }

  // Country aus PLZ/TLD? default DE
  result.country = "DE";

  return result;
}

export async function findAndParseImpressum(
  siteUrl: string
): Promise<ParsedImpressum> {
  const normalized = normalizeUrl(siteUrl);
  const baseOrigin = (() => {
    try {
      return new URL(normalized).origin;
    } catch {
      return normalized;
    }
  })();

  let homepage: { html: string; finalUrl: string } | null = await fetchHtml(normalized);
  if (!homepage) {
    // try origin
    homepage = await fetchHtml(baseOrigin);
  }
  if (!homepage) {
    return {
      impressumUrl: null,
      rawText: null,
      rawHtml: null,
      companyName: null,
      legalForm: null,
      address: null,
      zip: null,
      city: null,
      country: null,
      managingDirectors: null,
      registerCourt: null,
      registerNumber: null,
      ustId: null,
      email: null,
      phone: null,
      fax: null,
      error: `Homepage nicht erreichbar: ${normalized}`,
    };
  }

  const baseUrl = homepage.finalUrl;
  let candidates = findImpressumLinks(homepage.html, baseUrl);

  // falls keine Links gefunden, probiere Common Paths
  if (candidates.length === 0) {
    candidates = COMMON_PATHS.map((p) => baseOrigin + p);
  } else {
    // ergänze common paths als fallback
    for (const p of COMMON_PATHS) {
      const u = baseOrigin + p;
      if (!candidates.includes(u)) candidates.push(u);
    }
  }

  for (const cand of candidates) {
    const res = await fetchHtml(cand);
    if (!res) continue;
    const { text, html } = extractMainText(res.html);
    if (!text || text.length < 100) continue;
    // prüfe ob wirklich Impressum (enthält typische Begriffe)
    const lower = text.toLowerCase();
    const hasImpressumSignal =
      lower.includes("impressum") ||
      lower.includes("haftung") ||
      lower.includes("handelsregister") ||
      lower.includes("umsatzsteuer") ||
      lower.includes("vertreten durch") ||
      lower.includes("geschäftsführer");

    // auch wenn kein Signal, aber Text lang genug, akzeptieren falls URL impressum enthält
    const urlHasSignal = IMPRESSUM_HREF.test(cand.toLowerCase());
    if (!hasImpressumSignal && !urlHasSignal && text.length < 300) continue;

    const structured = parseStructuredFields(text);
    return {
      impressumUrl: cand,
      rawText: text.slice(0, 20000),
      rawHtml: html,
      companyName: structured.companyName || null,
      legalForm: structured.legalForm || null,
      address: structured.address || null,
      zip: structured.zip || null,
      city: structured.city || null,
      country: structured.country || null,
      managingDirectors: structured.managingDirectors || null,
      registerCourt: structured.registerCourt || null,
      registerNumber: structured.registerNumber || null,
      ustId: structured.ustId || null,
      email: structured.email || null,
      phone: structured.phone || null,
      fax: structured.fax || null,
      error: null,
    };
  }

  return {
    impressumUrl: null,
    rawText: null,
    rawHtml: null,
    companyName: null,
    legalForm: null,
    address: null,
    zip: null,
    city: null,
    country: null,
    managingDirectors: null,
    registerCourt: null,
    registerNumber: null,
    ustId: null,
    email: null,
    phone: null,
    fax: null,
    error: "Kein Impressum gefunden (keine Links und keine Common-Paths erfolgreich)",
  };
}

export function normalizeUrlExport(input: string) {
  return normalizeUrl(input);
}
