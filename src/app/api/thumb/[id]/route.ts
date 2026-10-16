import { getExtraction, cleanupStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function placeholderSvg() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360" fill="none">
    <rect width="640" height="360" fill="#0f172a"/>
    <circle cx="320" cy="180" r="44" fill="#6366f1" fill-opacity="0.2" stroke="#818cf8" stroke-width="2"/>
    <polygon points="312,166 334,180 312,194" fill="#ffffff"/>
    <text x="320" y="250" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="14" font-weight="600" text-anchor="middle">MEDIA PREVIEW</text>
  </svg>`;
  return new Response(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400",
    },
  });
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  cleanupStore();
  const { id } = await ctx.params;
  const urlObj = new URL(req.url);

  // 1. Direct URL query fallback (stateless banner loading)
  const directUrl = urlObj.searchParams.get("url");
  if (directUrl && /^https?:\/\//i.test(directUrl)) {
    try {
      const upstream = await fetch(directUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Referer: "https://www.youtube.com/",
        },
        redirect: "follow",
      });
      if (upstream.ok) {
        const ct = upstream.headers.get("content-type") || "image/jpeg";
        const headers = new Headers();
        headers.set("Content-Type", ct);
        headers.set("Cache-Control", "public, max-age=86400");
        return new Response(upstream.body, { status: 200, headers });
      }
    } catch {}
  }

  // 2. Lookup via database / memory / tmp
  const extraction = await getExtraction(id);
  const targetThumbnail = extraction?.thumbnail;

  if (targetThumbnail) {
    try {
      const upstream = await fetch(targetThumbnail, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Referer: "https://www.youtube.com/",
        },
        redirect: "follow",
      });
      if (upstream.ok) {
        const ct = upstream.headers.get("content-type") || "image/jpeg";
        const headers = new Headers();
        headers.set("Content-Type", ct);
        headers.set("Cache-Control", "public, max-age=86400");
        return new Response(upstream.body, { status: 200, headers });
      }
    } catch {}
  }

  return placeholderSvg();
}
