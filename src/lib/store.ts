import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { db } from "@/db";
import { extractions } from "@/db/schema";
import { eq } from "drizzle-orm";

export type MediaFormat = {
  url: string;
  ext: string;
  type: "video" | "audio" | "image";
  label: string;
  width?: number;
  height?: number;
  filesize?: number;
  hasAudio?: boolean;
  needsMerge?: boolean;
  audioFormatId?: string;
  headers?: Record<string, string>;
  cookies?: string;
  formatId?: string;
};

export type Extraction = {
  id: string;
  sourceUrl: string;
  title: string;
  thumbnail?: string;
  duration?: number;
  uploader?: string;
  platform?: string;
  formats: MediaFormat[];
  infoPath?: string;
  cookies?: string;
  proxy?: string;
  createdAt: number;
};

const DIR = "/tmp/media-extractions";

const globalStore = globalThis as typeof globalThis & {
  __mediaStore?: Map<string, Extraction>;
};

if (!globalStore.__mediaStore) {
  globalStore.__mediaStore = new Map<string, Extraction>();
}

export const mediaStore = globalStore.__mediaStore;

function ensureDir() {
  try {
    mkdirSync(DIR, { recursive: true });
  } catch {}
}

function withDbTimeout<T>(promise: Promise<T>, ms = 1200): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("Database operation timed out")), ms)
    ),
  ]);
}

export async function saveExtraction(e: Extraction): Promise<void> {
  // 1. In-memory
  mediaStore.set(e.id, e);

  // 2. Local /tmp
  try {
    ensureDir();
    writeFileSync(path.join(DIR, `${e.id}.json`), JSON.stringify(e));
  } catch {}

  // 3. PostgreSQL Database (with timeout to prevent freezing on Vercel)
  try {
    await withDbTimeout(
      db
        .insert(extractions)
        .values({
          id: e.id,
          sourceUrl: e.sourceUrl,
          title: e.title,
          thumbnail: e.thumbnail,
          duration: e.duration,
          uploader: e.uploader,
          platform: e.platform,
          formats: e.formats as any,
          cookies: e.cookies,
          proxy: e.proxy,
        })
        .onConflictDoUpdate({
          target: extractions.id,
          set: {
            title: e.title,
            thumbnail: e.thumbnail,
            duration: e.duration,
            uploader: e.uploader,
            platform: e.platform,
            formats: e.formats as any,
            cookies: e.cookies,
            proxy: e.proxy,
          },
        })
    );
  } catch {
    // If DB is unreachable or times out, memory and /tmp continue seamlessly
  }
}

export async function getExtraction(id: string): Promise<Extraction | undefined> {
  // 1. In-memory
  const mem = mediaStore.get(id);
  if (mem) return mem;

  // 2. Local /tmp
  try {
    const p = path.join(DIR, `${id}.json`);
    if (existsSync(p)) {
      const e = JSON.parse(readFileSync(p, "utf8")) as Extraction;
      mediaStore.set(id, e);
      return e;
    }
  } catch {}

  // 3. PostgreSQL Database (with timeout to prevent freezing on Vercel)
  try {
    const rows = await withDbTimeout(
      db.select().from(extractions).where(eq(extractions.id, id)).limit(1)
    );
    if (rows && rows.length > 0) {
      const r = rows[0];
      const e: Extraction = {
        id: r.id,
        sourceUrl: r.sourceUrl,
        title: r.title,
        thumbnail: r.thumbnail || undefined,
        duration: r.duration || undefined,
        uploader: r.uploader || undefined,
        platform: r.platform || undefined,
        formats: (r.formats as unknown as MediaFormat[]) || [],
        cookies: r.cookies || undefined,
        proxy: r.proxy || undefined,
        createdAt: r.createdAt ? r.createdAt.getTime() : Date.now(),
      };
      mediaStore.set(id, e);
      return e;
    }
  } catch {}

  return undefined;
}

export function cleanupStore() {
  const now = Date.now();
  const ttl = 1000 * 60 * 45;
  for (const [k, v] of mediaStore.entries()) {
    if (now - v.createdAt > ttl) mediaStore.delete(k);
  }
  try {
    ensureDir();
    for (const f of readdirSync(DIR)) {
      if (!f.endsWith(".json")) continue;
      const p = path.join(DIR, f);
      try {
        const e = JSON.parse(readFileSync(p, "utf8")) as Extraction;
        if (!e.createdAt || now - e.createdAt > ttl) unlinkSync(p);
      } catch {}
    }
  } catch {}
}
