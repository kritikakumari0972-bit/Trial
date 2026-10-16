import { spawn } from "node:child_process";
import {
  existsSync,
  chmodSync,
  createWriteStream,
  copyFileSync,
  mkdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { rename, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Extraction, MediaFormat } from "./store";

const YTDLP_RELEASE_URL =
  "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";
const TMP_BIN = "/tmp/yt-dlp";
const TMP_FFMPEG = "/tmp/ffmpeg";
const TMP_COOKIES = "/tmp/yt-cookies.txt";

let resolvedBin: string | null = null;
let resolvedFfmpeg: string | null = null;
let downloadPromise: Promise<string> | null = null;

function tryChmod(p: string): boolean {
  try {
    chmodSync(p, 0o755);
    return true;
  } catch {
    return false;
  }
}

async function downloadBinary(): Promise<string> {
  if (!downloadPromise) {
    downloadPromise = (async () => {
      const part = `${TMP_BIN}.part-${Date.now()}`;
      const res = await fetch(YTDLP_RELEASE_URL, { redirect: "follow" });
      if (!res.ok || !res.body) {
        downloadPromise = null;
        throw new Error(`Failed to download yt-dlp binary (HTTP ${res.status})`);
      }
      try {
        await pipeline(Readable.fromWeb(res.body as any), createWriteStream(part));
        await rename(part, TMP_BIN);
        tryChmod(TMP_BIN);
        return TMP_BIN;
      } catch (e) {
        downloadPromise = null;
        try {
          await unlink(part);
        } catch {}
        throw e;
      }
    })();
  }
  return downloadPromise;
}

export async function resolveBinary(): Promise<string> {
  if (resolvedBin && existsSync(resolvedBin)) {
    return resolvedBin;
  }

  if (existsSync(TMP_BIN)) {
    tryChmod(TMP_BIN);
    resolvedBin = TMP_BIN;
    return TMP_BIN;
  }

  const candidates = [
    process.env.YTDLP_PATH,
    path.join(process.cwd(), "bin", "yt-dlp"),
    path.join(__dirname, "..", "..", "bin", "yt-dlp"),
    "/usr/local/bin/yt-dlp",
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (existsSync(c)) {
      if (tryChmod(c)) {
        resolvedBin = c;
        return c;
      }
      try {
        copyFileSync(c, TMP_BIN);
        tryChmod(TMP_BIN);
        resolvedBin = TMP_BIN;
        return TMP_BIN;
      } catch {}
    }
  }

  const bin = await downloadBinary();
  resolvedBin = bin;
  return bin;
}

export async function resolveFfmpegBinary(): Promise<string | undefined> {
  if (resolvedFfmpeg && existsSync(resolvedFfmpeg)) {
    return resolvedFfmpeg;
  }

  if (existsSync(TMP_FFMPEG)) {
    tryChmod(TMP_FFMPEG);
    resolvedFfmpeg = TMP_FFMPEG;
    return TMP_FFMPEG;
  }

  let staticPath: string | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("ffmpeg-static");
    staticPath = typeof mod === "string" ? mod : mod?.default;
  } catch {}

  const candidates = [
    process.env.FFMPEG_PATH,
    staticPath,
    path.join(process.cwd(), "bin", "ffmpeg"),
    "/usr/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (existsSync(c)) {
      if (tryChmod(c)) {
        resolvedFfmpeg = c;
        return c;
      }
      try {
        copyFileSync(c, TMP_FFMPEG);
        tryChmod(TMP_FFMPEG);
        resolvedFfmpeg = TMP_FFMPEG;
        return TMP_FFMPEG;
      } catch {}
    }
  }

  return undefined;
}

export function platformFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host.includes("youtube") || host.includes("youtu.be")) return "YouTube";
    if (host.includes("tiktok")) return "TikTok";
    if (host.includes("facebook") || host.includes("fb.watch")) return "Facebook";
    if (host.includes("instagram")) return "Instagram";
    if (host.includes("pinterest") || host.includes("pin.it")) return "Pinterest";
    if (host.includes("snapchat")) return "Snapchat";
    if (host.includes("twitter") || host.includes("x.com")) return "X / Twitter";
    if (host.includes("reddit")) return "Reddit";
    if (host.includes("vimeo")) return "Vimeo";
    return host;
  } catch {
    return "Unknown";
  }
}

export function extractYoutubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1).split("/")[0].split("?")[0];
    if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/")[2]?.split("?")[0] || null;
    if (u.pathname.startsWith("/live/")) return u.pathname.split("/")[2]?.split("?")[0] || null;
    return u.searchParams.get("v") || u.pathname.split("/").pop()?.split("?")[0] || null;
  } catch {
    return null;
  }
}

export function formatNetscapeCookies(raw?: string): string {
  if (!raw || !raw.trim()) return "";
  const trimmed = raw.trim();
  if (trimmed.includes("\t") || trimmed.startsWith("# Netscape")) {
    return trimmed;
  }
  const lines = ["# Netscape HTTP Cookie File", "# Generated for Cloud / Vercel bypass"];
  for (const part of trimmed.split(";")) {
    const p = part.trim();
    if (!p) continue;
    const eq = p.indexOf("=");
    if (eq === -1) continue;
    const name = p.slice(0, eq).trim();
    const val = p.slice(eq + 1).trim();
    lines.push(`.youtube.com\tTRUE\t/\tTRUE\t2147483647\t${name}\t${val}`);
  }
  return lines.join("\n");
}

export function prepareCookiesFile(customCookie?: string): string | undefined {
  const content =
    customCookie ||
    process.env.YOUTUBE_COOKIES ||
    process.env.COOKIES ||
    process.env.COOKIE;

  if (content && content.trim()) {
    try {
      const netscape = formatNetscapeCookies(content);
      writeFileSync(TMP_COOKIES, netscape, "utf8");
      return TMP_COOKIES;
    } catch {}
  }

  const candidates = [
    process.env.YOUTUBE_COOKIES_FILE,
    process.env.COOKIES_FILE,
    path.join(process.cwd(), "cookies.txt"),
    path.join(process.cwd(), "bin", "cookies.txt"),
    TMP_COOKIES,
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (existsSync(c) && statSync(c).size > 10) {
      return c;
    }
  }

  return undefined;
}

export function getProxyUrl(customProxy?: string): string | undefined {
  return (
    customProxy ||
    process.env.YTDLP_PROXY ||
    process.env.YOUTUBE_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.ALL_PROXY
  );
}

function isStoryboard(f: any): boolean {
  const note = String(f?.format_note || "").toLowerCase();
  if (note.includes("storyboard")) return true;
  if (f?.ext === "mhtml") return true;
  if (f?.protocol === "mhtml") return true;
  return false;
}

function isManifest(f: any): boolean {
  const proto = String(f?.protocol || "").toLowerCase();
  const ext = String(f?.ext || "").toLowerCase();
  const url = String(f?.url || "").toLowerCase();
  if (proto.includes("dash") || proto.includes("mhtml") || proto.includes("rtmp")) return true;
  if (["mpd", "mhtml", "ism", "smil"].includes(ext)) return true;
  if (url.includes(".mpd") || url.includes("/manifest")) return true;
  return false;
}

function execYtDlpJson(bin: string, args: string[]): Promise<any> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    const proc = spawn(bin, args, { env });
    let stdout = "";
    let stderr = "";
    const MAX = 50 * 1024 * 1024;
    const timer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {}
      reject(new Error("Extraction timed out"));
    }, 150000);

    proc.stdout.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
      if (stdout.length > MAX) {
        try {
          proc.kill("SIGKILL");
        } catch {}
        reject(new Error("Output too large"));
      }
    });
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
        return;
      }
      const lines = stdout.trim().split(/\n/);
      let jsonLine = "";
      for (let i = lines.length - 1; i >= 0; i--) {
        const t = lines[i].trim();
        if (t.startsWith("{")) {
          jsonLine = t;
          break;
        }
      }
      if (!jsonLine) {
        reject(new Error("No JSON output from yt-dlp"));
        return;
      }
      try {
        resolve(JSON.parse(jsonLine));
      } catch {
        reject(new Error("Failed to parse yt-dlp output"));
      }
    });
  });
}

export async function fetchInvidiousExtraction(id: string, sourceUrl: string): Promise<Extraction | null> {
  const ytId = extractYoutubeId(sourceUrl);
  if (!ytId) return null;

  try {
    const oembedRes = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${ytId}&format=json`,
      { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(5000) }
    );
    if (oembedRes.ok) {
      const oembed = await oembedRes.json();
      const thumb = oembed.thumbnail_url || `https://i.ytimg.com/vi/${ytId}/maxresdefault.jpg`;
      const formats: MediaFormat[] = [
        {
          url: `https://www.youtube.com/watch?v=${ytId}`,
          ext: "mp4",
          type: "video",
          label: "HD Video MP4",
          hasAudio: true,
          needsMerge: true,
        },
        {
          url: `https://www.youtube.com/watch?v=${ytId}`,
          ext: "m4a",
          type: "audio",
          label: "Audio M4A",
          hasAudio: true,
          needsMerge: false,
        },
        {
          url: thumb,
          ext: "jpg",
          type: "image",
          label: "Thumbnail JPG",
          hasAudio: false,
          needsMerge: false,
        },
      ];
      return {
        id,
        sourceUrl,
        title: oembed.title || "YouTube Video",
        uploader: oembed.author_name,
        platform: "YouTube",
        thumbnail: thumb,
        formats,
        createdAt: Date.now(),
      };
    }
  } catch {}

  return null;
}

export type RunOptions = {
  cookies?: string;
  proxy?: string;
};

export async function runYtDlp(url: string, opts?: RunOptions): Promise<any> {
  const bin = await resolveBinary();
  const isYt = platformFromUrl(url) === "YouTube";
  const cookiesFile = prepareCookiesFile(opts?.cookies);
  const proxy = getProxyUrl(opts?.proxy);

  const baseArgs = [
    "--js-runtimes",
    "node",
    "--remote-components",
    "ejs:github",
    "--dump-json",
    "--no-download",
    "--no-playlist",
    "--no-warnings",
  ];

  if (cookiesFile) baseArgs.push("--cookies", cookiesFile);
  if (proxy) baseArgs.push("--proxy", proxy);

  if (!isYt) {
    const args = [...baseArgs, "--impersonate", "chrome", url];
    return execYtDlpJson(bin, args);
  }

  let poTokenArg = "";
  if (process.env.YOUTUBE_PO_TOKEN) {
    poTokenArg = `;po_token=${process.env.YOUTUBE_PO_TOKEN}`;
  }
  if (process.env.YOUTUBE_VISITOR_DATA) {
    poTokenArg += `;visitor_data=${process.env.YOUTUBE_VISITOR_DATA}`;
  }

  // TV + web_safari client bypasses datacenter IP blocks completely
  const clientStrategies = [
    `tv,web_safari${poTokenArg}`,
    `web_embedded,web_safari${poTokenArg}`,
    `android_vr,web_safari${poTokenArg}`,
    `default${poTokenArg}`,
  ];

  let lastError: Error | null = null;

  for (const client of clientStrategies) {
    try {
      const args = [
        ...baseArgs,
        "--extractor-args",
        `youtube:player_client=${client}`,
        url,
      ];
      const json = await execYtDlpJson(bin, args);
      if (json && (json.formats || json.url)) {
        return json;
      }
    } catch (err: any) {
      lastError = err;
      const msg = String(err?.message || "").toLowerCase();
      if (!msg.includes("bot") && !msg.includes("sign in") && !msg.includes("429") && !msg.includes("cookie")) {
        break;
      }
    }
  }

  throw lastError || new Error("Failed to extract YouTube video information");
}

function parseHeaders(f: any): Record<string, string> | undefined {
  if (f?.http_headers && typeof f.http_headers === "object") {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(f.http_headers)) {
      headers[k] = String(v);
    }
    return Object.keys(headers).length ? headers : undefined;
  }
  return undefined;
}

export function buildExtraction(id: string, sourceUrl: string, info: any): Extraction {
  const rawFormats: any[] = Array.isArray(info?.formats) ? [...info.formats] : [];
  if (info?.url && !rawFormats.some((f) => f.url === info.url)) {
    rawFormats.unshift({
      url: info.url,
      ext: info.ext || "mp4",
      format_id: "best_direct",
      format_note: info.format_note || "Direct HD",
      height: info.height || 720,
      width: info.width,
      vcodec: info.vcodec,
      acodec: info.acodec,
      filesize: info.filesize || info.filesize_approx,
    });
  }

  const validFormats = rawFormats.filter((f) => !isStoryboard(f) && !isManifest(f) && f?.url);

  const isAudioOnly = (f: any): boolean => {
    const v = String(f?.vcodec || "none");
    const a = String(f?.acodec || "none");
    const isVNone = v === "none" || v === "null" || v === "";
    const hasA = a !== "none" && a !== "null" && a !== "";
    return isVNone && hasA;
  };

  const isVideo = (f: any): boolean => {
    if (isAudioOnly(f)) return false;
    const v = String(f?.vcodec || "");
    if (v && v !== "none" && v !== "null") return true;
    const ext = String(f?.ext || "").toLowerCase();
    if (["mp4", "webm", "mkv", "mov", "avi"].includes(ext)) {
      return true;
    }
    return false;
  };

  const audioFormats = validFormats.filter(isAudioOnly);
  audioFormats.sort((a, b) => (b.tbr || b.abr || 0) - (a.tbr || a.abr || 0));
  const bestAudio = audioFormats[0];
  const bestAudioId = bestAudio?.format_id ? String(bestAudio.format_id) : undefined;

  const hasGlobalAudio =
    audioFormats.length > 0 ||
    validFormats.some((f) => {
      const a = f?.acodec;
      return a !== "none";
    });

  const videoFormats = validFormats.filter(isVideo);
  const byHeight = new Map<number, any>();
  const unmeasuredVideos: any[] = [];

  for (const v of videoFormats) {
    const h = v.height ? Number(v.height) : undefined;
    if (!h) {
      unmeasuredVideos.push(v);
      continue;
    }
    const existing = byHeight.get(h);
    if (!existing) {
      byHeight.set(h, v);
    } else {
      const existingHasA = existing.acodec && existing.acodec !== "none";
      const newHasA = v.acodec && v.acodec !== "none";
      const existingIsMp4 = existing.ext === "mp4";
      const newIsMp4 = v.ext === "mp4";
      const existingScore = (existingHasA ? 10 : 0) + (existingIsMp4 ? 5 : 0);
      const newScore = (newHasA ? 10 : 0) + (newIsMp4 ? 5 : 0);
      if (newScore > existingScore) {
        byHeight.set(h, v);
      }
    }
  }

  const finalVideoFormats: MediaFormat[] = [];
  const sortedHeights = Array.from(byHeight.keys()).sort((a, b) => b - a);

  for (const h of sortedHeights) {
    const v = byHeight.get(h);
    const isExplicitlySilent = v.acodec === "none";
    const needsMerge = isExplicitlySilent && hasGlobalAudio;
    const hasAudio = !isExplicitlySilent || hasGlobalAudio;

    let qualityLabel = `${h}p`;
    if (h >= 2160) qualityLabel = `4K ${h}p`;
    else if (h >= 1440) qualityLabel = `2K ${h}p`;
    else if (h >= 1080) qualityLabel = `Full HD ${h}p`;
    else if (h >= 720) qualityLabel = `HD ${h}p`;

    finalVideoFormats.push({
      formatId: v.format_id ? String(v.format_id) : undefined,
      audioFormatId: needsMerge ? bestAudioId : undefined,
      url: String(v.url),
      ext: "mp4",
      type: "video",
      label: `${qualityLabel} MP4${hasAudio ? "" : " (no audio)"}`,
      width: v.width ? Number(v.width) : undefined,
      height: h,
      filesize: v.filesize || v.filesize_approx ? Number(v.filesize || v.filesize_approx) : undefined,
      hasAudio,
      needsMerge,
      headers: parseHeaders(v),
      cookies: v.cookies ? String(v.cookies) : undefined,
    });
  }

  if (unmeasuredVideos.length) {
    for (const v of unmeasuredVideos.slice(0, 3)) {
      const isExplicitlySilent = v.acodec === "none";
      const needsMerge = isExplicitlySilent && hasGlobalAudio;
      const hasAudio = !isExplicitlySilent || hasGlobalAudio;
      const note = v.format_note || (v.format_id === "hd" ? "HD Video" : v.format_id === "sd" ? "SD Video" : "Video");
      finalVideoFormats.push({
        formatId: v.format_id ? String(v.format_id) : undefined,
        audioFormatId: needsMerge ? bestAudioId : undefined,
        url: String(v.url),
        ext: String(v.ext || "mp4").toLowerCase(),
        type: "video",
        label: `${note} MP4${hasAudio ? "" : " (no audio)"}`,
        filesize: v.filesize || v.filesize_approx ? Number(v.filesize || v.filesize_approx) : undefined,
        hasAudio,
        needsMerge,
        headers: parseHeaders(v),
        cookies: v.cookies ? String(v.cookies) : undefined,
      });
    }
  }

  // Prioritize instantly playable/downloadable formats with audio
  finalVideoFormats.sort((a, b) => {
    const rank = (f: MediaFormat) => {
      let r = 0;
      if (!f.needsMerge) r += 50000;
      const h = f.height || 0;
      if (h === 720) r += 10000;
      else if (h === 1080) r += 8000;
      else if (h === 480) r += 6000;
      else if (h === 360) r += 4000;
      else r += h;
      return r;
    };
    return rank(b) - rank(a);
  });

  const trimmedVideos = finalVideoFormats.slice(0, 5);

  const finalAudioFormats: MediaFormat[] = [];
  if (bestAudio) {
    finalAudioFormats.push({
      formatId: bestAudio.format_id ? String(bestAudio.format_id) : undefined,
      url: String(bestAudio.url),
      ext: String(bestAudio.ext || "m4a").toLowerCase(),
      type: "audio",
      label: `Audio ${String(bestAudio.ext || "M4A").toUpperCase()}`,
      filesize: bestAudio.filesize || bestAudio.filesize_approx ? Number(bestAudio.filesize || bestAudio.filesize_approx) : undefined,
      hasAudio: true,
      needsMerge: false,
      headers: parseHeaders(bestAudio),
      cookies: bestAudio.cookies ? String(bestAudio.cookies) : undefined,
    });
  }

  const thumb = info?.thumbnail ? String(info.thumbnail) : undefined;
  const finalImageFormats: MediaFormat[] = [];
  if (thumb) {
    const cleanPath = thumb.split("?")[0].toLowerCase();
    let text = "jpg";
    if (cleanPath.endsWith(".webp")) text = "webp";
    else if (cleanPath.endsWith(".png")) text = "png";
    finalImageFormats.push({
      url: thumb,
      ext: text,
      type: "image",
      label: `Thumbnail ${text.toUpperCase()}`,
      hasAudio: false,
      needsMerge: false,
    });
  }

  const allFormats: MediaFormat[] = [...trimmedVideos, ...finalAudioFormats, ...finalImageFormats];

  return {
    id,
    sourceUrl,
    title: String(info?.title || info?.fulltitle || "Untitled media"),
    thumbnail: thumb,
    duration: info?.duration ? Number(info.duration) : undefined,
    uploader: info?.uploader || info?.channel || info?.creator || info?.author || undefined,
    platform: platformFromUrl(sourceUrl),
    formats: allFormats.length ? allFormats : (rawFormats as MediaFormat[]),
    createdAt: Date.now(),
  };
}

const INFO_DIR = "/tmp/media-info";
const CACHE_DIR = "/tmp/media-cache";

export async function saveInfoJson(id: string, info: any): Promise<string | undefined> {
  try {
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(INFO_DIR, { recursive: true });
    const p = path.join(INFO_DIR, `${id}.json`);
    await writeFile(p, JSON.stringify(info), "utf8");
    return p;
  } catch {
    return undefined;
  }
}

const activeMerges = new Map<string, Promise<void>>();

export async function ensureMergedMediaFile(
  extraction: Extraction,
  fmt: MediaFormat,
  destPath: string
): Promise<void> {
  if (existsSync(destPath) && statSync(destPath).size > 1000) {
    return;
  }

  let inFlight = activeMerges.get(destPath);
  if (!inFlight) {
    inFlight = (async () => {
      try {
        mkdirSync(CACHE_DIR, { recursive: true });
        const bin = await resolveBinary();
        const ffmpegBin = await resolveFfmpegBinary();
        const cookiesFile = prepareCookiesFile(extraction.cookies);
        const proxy = getProxyUrl(extraction.proxy);
        const isYt = extraction.platform === "YouTube";

        const formatSpec = fmt.formatId
          ? `${fmt.formatId}+${fmt.audioFormatId || "bestaudio"}/best`
          : "bestvideo+bestaudio/best";

        const baseArgs = [
          "--js-runtimes",
          "node",
          "--remote-components",
          "ejs:github",
          "--no-warnings",
          "-f",
          formatSpec,
          "--merge-output-format",
          "mp4",
        ];

        if (isYt) {
          baseArgs.push(
            "--extractor-args",
            "youtube:player_client=tv,web_safari"
          );
        } else {
          baseArgs.push("--impersonate", "chrome");
        }

        if (cookiesFile) baseArgs.push("--cookies", cookiesFile);
        if (proxy) baseArgs.push("--proxy", proxy);
        if (ffmpegBin) baseArgs.push("--ffmpeg-location", ffmpegBin);

        if (extraction.infoPath && existsSync(extraction.infoPath)) {
          const loadArgs = [...baseArgs, "--load-info-json", extraction.infoPath, "-o", destPath];
          const success = await executeProcess(bin, loadArgs);
          if (success && existsSync(destPath) && statSync(destPath).size > 1000) {
            return;
          }
        }

        const directArgs = [...baseArgs, "-o", destPath, extraction.sourceUrl];
        const ok = await executeProcess(bin, directArgs);
        if (!ok || !existsSync(destPath) || statSync(destPath).size < 1000) {
          throw new Error("Failed to process and merge media audio and video");
        }
      } finally {
        activeMerges.delete(destPath);
      }
    })();
    activeMerges.set(destPath, inFlight);
  }

  return inFlight;
}

export async function ensureSingleMediaFile(
  extraction: Extraction,
  fmt: MediaFormat,
  destPath: string
): Promise<void> {
  if (existsSync(destPath) && statSync(destPath).size > 1000) {
    return;
  }

  let inFlight = activeMerges.get(destPath);
  if (!inFlight) {
    inFlight = (async () => {
      try {
        mkdirSync(CACHE_DIR, { recursive: true });
        const bin = await resolveBinary();
        const ffmpegBin = await resolveFfmpegBinary();
        const cookiesFile = prepareCookiesFile(extraction.cookies);
        const proxy = getProxyUrl(extraction.proxy);
        const isYt = extraction.platform === "YouTube";

        const formatSpec = fmt.formatId || "best";
        const baseArgs = [
          "--js-runtimes",
          "node",
          "--remote-components",
          "ejs:github",
          "--no-warnings",
          "-f",
          formatSpec,
        ];

        if (isYt) {
          baseArgs.push(
            "--extractor-args",
            "youtube:player_client=tv,web_safari"
          );
        } else {
          baseArgs.push("--impersonate", "chrome");
        }

        if (cookiesFile) baseArgs.push("--cookies", cookiesFile);
        if (proxy) baseArgs.push("--proxy", proxy);
        if (ffmpegBin) baseArgs.push("--ffmpeg-location", ffmpegBin);

        if (extraction.infoPath && existsSync(extraction.infoPath)) {
          const loadArgs = [...baseArgs, "--load-info-json", extraction.infoPath, "-o", destPath];
          const success = await executeProcess(bin, loadArgs);
          if (success && existsSync(destPath) && statSync(destPath).size > 1000) {
            return;
          }
        }

        const directArgs = [...baseArgs, "-o", destPath, extraction.sourceUrl];
        const ok = await executeProcess(bin, directArgs);
        if (!ok || !existsSync(destPath) || statSync(destPath).size < 1000) {
          throw new Error("Failed to download media file");
        }
      } finally {
        activeMerges.delete(destPath);
      }
    })();
    activeMerges.set(destPath, inFlight);
  }

  return inFlight;
}

function executeProcess(bin: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(bin, args, {
      env: { ...process.env },
      stdio: ["ignore", "ignore", "ignore"],
    });
    const timer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {}
      resolve(false);
    }, 120000);

    proc.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

export function buildDirectExtraction(id: string, sourceUrl: string): Extraction {
  const ext = sourceUrl.split("?")[0].split(".").pop()?.toLowerCase() || "mp4";
  const isImage = ["jpg", "jpeg", "png", "webp", "gif"].includes(ext);
  return {
    id,
    sourceUrl,
    title: "Direct media",
    platform: platformFromUrl(sourceUrl),
    formats: [
      {
        url: sourceUrl,
        ext,
        type: isImage ? "image" : "video",
        label: isImage ? "Image" : "Video",
        hasAudio: isImage ? false : true,
        needsMerge: false,
      },
    ],
    createdAt: Date.now(),
  };
}
