// Browser security headers (#143): a per-request nonce-based Content-Security-Policy on HTML
// responses, and the other hardening headers on every response the app renders (pages, `.data`
// requests, resource routes, error pages). See docs/security.md.
import { randomBytes } from "node:crypto";
import { createContext, type MiddlewareFunction } from "react-router";
import { type Env, getEnv } from "./env";

export type CspMode = Env["CSP_MODE"];

/** Where browsers send CSP violation reports (`routes/csp-report.ts`). */
export const CSP_REPORT_PATH = "/csp-report";

/** The `Reporting-Endpoints` name the `report-to` directive refers to. */
const CSP_REPORT_GROUP = "csp";

/**
 * Frames the page may embed: the home page's map (`features/home/LocationSection.tsx`), a Google
 * Maps embed URL from Strapi's `mapEmbedUrl`. Another map provider needs its origin here.
 */
const FRAME_ORIGINS = ["https://www.google.com", "https://maps.google.com"];

export interface CspOptions {
  nonce: string;
  /** Origin of `STRAPI_URL`: CMS and product images are its `/uploads/…` URLs. */
  strapiOrigin: string;
  /** Development adds `ws:` to `connect-src` for Vite's HMR socket. */
  isDev: boolean;
}

/** The policy's directives, without the header name. */
export function buildCsp({ nonce, strapiOrigin, isDev }: CspOptions): string {
  const directives: [string, ...string[]][] = [
    ["default-src", "'self'"],
    // 'strict-dynamic' lets the nonced bootstrap load the route modules; 'self' is the fallback
    // for browsers without it. Never 'unsafe-inline' for scripts.
    ["script-src", "'self'", `'nonce-${nonce}'`, "'strict-dynamic'"],
    // React `style` attributes (e.g. the order progress bar) and Vite dev's <style> tags.
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", "'self'", "data:", strapiOrigin],
    // Vite inlines small font subsets (under 4 KB) as `data:` URIs in the stylesheet.
    ["font-src", "'self'", "data:"],
    ["connect-src", "'self'", ...(isDev ? ["ws:"] : [])],
    ["frame-src", ...FRAME_ORIGINS],
    ["frame-ancestors", "'none'"],
    ["base-uri", "'self'"],
    // Forms post only to the shop. A real card payment provider's hosted page is cross-origin:
    // add its origin here together with the provider (Chrome checks form-action on redirects).
    ["form-action", "'self'"],
    ["object-src", "'none'"],
    ["report-uri", CSP_REPORT_PATH],
    ["report-to", CSP_REPORT_GROUP],
  ];
  return directives.map((parts) => parts.join(" ")).join("; ");
}

export interface SecurityHeadersOptions {
  env: Pick<Env, "NODE_ENV" | "PUBLIC_SITE_URL" | "STRAPI_URL" | "CSP_MODE">;
  /** The CSP goes only on HTML responses; it means nothing on XML, images or JSON. */
  html: boolean;
  nonce: string;
}

/** Every security header for one response. */
export function buildSecurityHeaders({ env, html, nonce }: SecurityHeadersOptions): Headers {
  const headers = new Headers({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
  });

  // Behind a TLS-terminating proxy the request itself is http, so the public origin decides.
  if (env.NODE_ENV === "production" && env.PUBLIC_SITE_URL?.startsWith("https://")) {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  if (html) {
    const policy = buildCsp({
      nonce,
      strapiOrigin: new URL(env.STRAPI_URL).origin,
      isDev: env.NODE_ENV === "development",
    });
    const name =
      env.CSP_MODE === "enforce"
        ? "Content-Security-Policy"
        : "Content-Security-Policy-Report-Only";
    headers.set(name, policy);
    headers.set("Reporting-Endpoints", `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`);
  }

  return headers;
}

/** A fresh nonce: 128 random bits, base64. */
export function createNonce(): string {
  return randomBytes(16).toString("base64");
}

/** This request's CSP nonce, set by `securityHeadersMiddleware` and read by `entry.server.tsx`. */
export const nonceContext = createContext<string>("");

function isHtml(response: Response): boolean {
  return response.headers.get("Content-Type")?.startsWith("text/html") ?? false;
}

/** `response` with `headers` set, copied first when its headers are immutable. */
function withHeaders(response: Response, headers: Headers): Response {
  let target = response;
  try {
    for (const [name, value] of headers) target.headers.set(name, value);
  } catch {
    // e.g. `Response.redirect()` or a fetched response: immutable headers.
    target = new Response(response.body, response);
    for (const [name, value] of headers) target.headers.set(name, value);
  }
  return target;
}

export function createSecurityHeadersMiddleware(
  env: () => SecurityHeadersOptions["env"] = getEnv,
): MiddlewareFunction<Response> {
  return async ({ context }, next) => {
    const nonce = createNonce();
    context.set(nonceContext, nonce);
    const response = await next();
    return withHeaders(
      response,
      buildSecurityHeaders({ env: env(), html: isHtml(response), nonce }),
    );
  };
}

/** The root's first middleware: wraps every route, redirect and error response. */
export const securityHeadersMiddleware = createSecurityHeadersMiddleware();
