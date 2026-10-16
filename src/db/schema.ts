import { pgTable, varchar, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

export const extractions = pgTable("extractions", {
  id: varchar("id", { length: 128 }).primaryKey(),
  sourceUrl: text("source_url").notNull(),
  title: text("title").notNull(),
  thumbnail: text("thumbnail"),
  duration: integer("duration"),
  uploader: text("uploader"),
  platform: varchar("platform", { length: 64 }),
  formats: jsonb("formats").notNull(),
  infoJson: text("info_json"),
  cookies: text("cookies"),
  proxy: text("proxy"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
