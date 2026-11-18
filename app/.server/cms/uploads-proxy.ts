import { uploadPathSchema } from "~/lib/uploads.schema";

// The app's proxy for Strapi's media (#176): `/uploads/<path>` on the shop's origin answers with
// `${STRAPI_URL}/uploads/<path>`, fetched on the server. Strapi stays internal (`http://cms:1337`
// in production), images are same-origin for the CSP, and the same code runs in development.

/** Strapi's file names carry a content hash, so a changed image gets a new URL. */
export const UPLOAD_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** The most one file may take to start arriving from Strapi. */
export const UPLOAD_TIMEOUT_MS = 10_000;

/** Headers passed on from Strapi; everything else (cookies, `Server`, …) is dropped. */
const PASSED_HEADERS = ["content-type", "content-length", "etag", "last-modified"];

/** Request headers passed on to Strapi, for 304s. */
const CONDITIONAL_HEADERS = ["if-none-match", "if-modified-since"];

function empty(status: number): Response {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

export interface ProxyUploadOptions {
  /** The internal Strapi URL, e.g. `http://cms:1337`. */
  strapiUrl: string;
  /** The path after `/uploads/`, e.g. `small_photo_3f2a.jpg`. */
  path: string | undefined;
  request: Request;
  fetch?: typeof fetch;
}

/**
 * Fetches one Strapi upload and answers with it: the file with a year-long `Cache-Control`, a 304
 * when the browser's copy is current, a 404 for a path that isn't a file name or that Strapi
 * doesn't have, and a 502 when Strapi is down or slow.
 */
export async function proxyUpload({
  strapiUrl,
  path,
  request,
  fetch: fetchImpl = fetch,
}: ProxyUploadOptions): Promise<Response> {
  const parsed = uploadPathSchema.safeParse(path);
  if (!parsed.success) {
    return empty(404);
  }
  const base = strapiUrl.endsWith("/") ? strapiUrl : `${strapiUrl}/`;
  const url = new URL(`uploads/${parsed.data}`, base);

  const headers = new Headers();
  for (const name of CONDITIONAL_HEADERS) {
    const value = request.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }

  let upstream: Response;
  try {
    upstream = await fetchImpl(url, {
      method: request.method === "HEAD" ? "HEAD" : "GET",
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
  } catch {
    return empty(502);
  }

  if (upstream.status === 404) {
    await upstream.body?.cancel();
    return empty(404);
  }
  if (upstream.status !== 200 && upstream.status !== 304) {
    await upstream.body?.cancel();
    return empty(502);
  }

  const passed = new Headers({ "Cache-Control": UPLOAD_CACHE_CONTROL });
  for (const name of PASSED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) {
      passed.set(name, value);
    }
  }
  if (upstream.status === 304 || request.method === "HEAD") {
    await upstream.body?.cancel();
    return new Response(null, { status: upstream.status, headers: passed });
  }
  return new Response(upstream.body, { status: 200, headers: passed });
}
