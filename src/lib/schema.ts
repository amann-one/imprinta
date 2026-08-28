import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const sites = sqliteTable("sites", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  url: text("url").notNull().unique(),
  originalUrl: text("original_url"),
  domain: text("domain"),
  status: text("status").notNull().default("pending"), // pending | scraping | done | error
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
  error: text("error"),
  source: text("source"), // Quelle des Imports (z.B. Dateiname, Sheet-URL, Label)
});

export const impressum = sqliteTable("impressum", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  siteId: integer("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  impressumUrl: text("impressum_url"),
  rawText: text("raw_text"),
  rawHtml: text("raw_html"),
  // strukturierte Felder
  companyName: text("company_name"),
  legalForm: text("legal_form"),
  address: text("address"),
  zip: text("zip"),
  city: text("city"),
  country: text("country"),
  managingDirectors: text("managing_directors"),
  registerCourt: text("register_court"),
  registerNumber: text("register_number"),
  ustId: text("ust_id"),
  email: text("email"),
  phone: text("phone"),
  fax: text("fax"),
  fetchedAt: text("fetched_at").$defaultFn(() => new Date().toISOString()),
  error: text("error"),
});

export type Site = typeof sites.$inferSelect;
export type NewSite = typeof sites.$inferInsert;
export type Impressum = typeof impressum.$inferSelect;
