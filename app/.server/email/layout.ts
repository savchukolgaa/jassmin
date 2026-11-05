// The one branded layout every email uses (#134). A builder describes its email as a list of
// blocks; `renderEmail` turns that one list into both the HTML and the plain-text part, so the two
// can't drift apart. `composeEmail` adds the headers every email needs (Reply-To and a Message-ID
// on the sender's domain).
//
// The HTML follows the Option C+ colours in `docs/design.md`, inline-styled and table-based, since
// email clients ignore `<style>`, CSS variables and web fonts. C+ is light-only. Every value that
// goes into the HTML is escaped here: blocks carry plain text, never HTML.
import { randomUUID } from "node:crypto";
import type Mail from "nodemailer/lib/mailer";
import type { Translator } from "~/lib/i18n";

/** The C+ tokens the layout uses (`docs/design.md` → Colour tokens). */
export const EMAIL_COLORS = {
  primary: "#C22F4B",
  ink: "#1F1A1C",
  body: "#4A4245",
  muted: "#5F5558",
  blush: "#FFF4F5",
  card: "#F7F3F4",
  line: "#E5DADD",
  white: "#FFFFFF",
} as const;

const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "Arial, Helvetica, sans-serif";
const MONO = "'Courier New', Courier, monospace";

/** A label and value row; `strong` marks the total. */
export interface EmailAmount {
  label: string;
  value: string;
  strong?: boolean;
}

/** One piece of an email body, in plain text. Line breaks in `text` are kept. */
export type EmailBlock =
  | { type: "paragraph"; text: string }
  /** A section heading; the text part puts the next block right under it. */
  | { type: "heading"; text: string }
  /** Short lines shown one under the other, e.g. order lines or an address. */
  | { type: "lines"; items: string[] }
  /** Label/value rows, e.g. subtotal, delivery and total. */
  | { type: "amounts"; rows: EmailAmount[] }
  /** A code to copy (a gift card's), with an optional line under it. */
  | { type: "code"; label: string; code: string; note?: string }
  /**
   * A link styled as a button, with the URL written out under it for clients that hide styled
   * links (#135). Only `http(s)` URLs become links; anything else is shown as text.
   */
  | { type: "button"; label: string; url: string }
  | { type: "signature"; text: string };

/** What the footer shows: the shop's inbox and, when known, the site. */
export interface EmailFooter {
  inbox: string;
  /** The site's origin (`PUBLIC_SITE_URL`); the link is left out when unset. */
  siteUrl?: string | undefined;
}

export interface RenderedEmail {
  html: string;
  text: string;
}

/** `value` with the HTML special characters escaped, for text and attribute values alike. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Escaped text with its line breaks as `<br>`. */
function escapeLines(value: string): string {
  return escapeHtml(value.replace(/\r\n?/g, "\n")).replaceAll("\n", "<br>");
}

function paragraph(content: string, style = ""): string {
  return `<p style="margin:0 0 16px;${style}">${content}</p>`;
}

function blockHtml(block: EmailBlock): string {
  switch (block.type) {
    case "paragraph":
      return paragraph(escapeLines(block.text));
    case "heading":
      return `<h2 style="margin:24px 0 8px;font-family:${SERIF};font-size:20px;line-height:1.3;font-weight:bold;color:${EMAIL_COLORS.ink};">${escapeHtml(block.text)}</h2>`;
    case "lines":
      return paragraph(block.items.map(escapeLines).join("<br>"));
    case "amounts": {
      const rows = block.rows
        .map(({ label, value, strong }) => {
          const style = strong
            ? `padding:12px 16px;border-top:1px solid ${EMAIL_COLORS.line};font-weight:bold;color:${EMAIL_COLORS.ink};`
            : "padding:8px 16px;";
          return `<tr><td style="${style}">${escapeHtml(label)}</td><td align="right" style="${style}white-space:nowrap;">${escapeHtml(value)}</td></tr>`;
        })
        .join("");
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;border-collapse:collapse;background:${EMAIL_COLORS.card};">${rows}</table>`;
    }
    case "code":
      return [
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;border-collapse:collapse;background:${EMAIL_COLORS.blush};border:1px solid ${EMAIL_COLORS.line};">`,
        `<tr><td align="center" style="padding:16px;">`,
        `<p style="margin:0 0 4px;font-size:14px;color:${EMAIL_COLORS.muted};">${escapeHtml(block.label)}</p>`,
        `<p style="margin:0;font-family:${MONO};font-size:24px;font-weight:bold;letter-spacing:2px;color:${EMAIL_COLORS.ink};">${escapeHtml(block.code)}</p>`,
        block.note
          ? `<p style="margin:8px 0 0;font-size:14px;color:${EMAIL_COLORS.muted};">${escapeLines(block.note)}</p>`
          : "",
        "</td></tr></table>",
      ].join("");
    case "button": {
      if (!/^https?:\/\//i.test(block.url)) {
        return paragraph(`${escapeHtml(block.label)}: ${escapeHtml(block.url)}`);
      }
      const href = escapeHtml(block.url);
      return [
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 16px;border-collapse:separate;">`,
        `<tr><td align="center" style="border-radius:999px;background:${EMAIL_COLORS.primary};">`,
        `<a href="${href}" style="display:inline-block;padding:14px 28px;font-family:${SANS};font-size:16px;font-weight:bold;color:${EMAIL_COLORS.white};text-decoration:none;border-radius:999px;">${escapeHtml(block.label)}</a>`,
        "</td></tr></table>",
        paragraph(
          `<a href="${href}" style="color:${EMAIL_COLORS.primary};word-break:break-all;">${href}</a>`,
          `font-size:14px;color:${EMAIL_COLORS.muted};`,
        ),
      ].join("");
    }
    case "signature":
      return paragraph(escapeLines(block.text), `margin-top:24px;color:${EMAIL_COLORS.ink};`);
  }
}

function blockText(block: EmailBlock): string {
  switch (block.type) {
    case "paragraph":
    case "heading":
    case "signature":
      return block.text;
    case "lines":
      return block.items.join("\n");
    case "amounts":
      return block.rows.map(({ label, value }) => `${label}: ${value}`).join("\n");
    case "code":
      return [`${block.label}: ${block.code}`, ...(block.note ? [block.note] : [])].join("\n");
    case "button":
      return `${block.label}:\n${block.url}`;
  }
}

/** The body as plain text: blocks apart by a blank line, a heading right above its block. */
function bodyText(blocks: EmailBlock[]): string {
  let text = "";
  blocks.forEach((block, index) => {
    if (index > 0) {
      text += blocks[index - 1]?.type === "heading" ? "\n" : "\n\n";
    }
    text += blockText(block);
  });
  return text;
}

/** The site's origin without the scheme, for the footer link's text. */
function siteLabel(siteUrl: string): string {
  return siteUrl.replace(/^https?:\/\//, "");
}

/** The email's HTML and plain-text parts, in the translator's language. */
export function renderEmail(
  blocks: EmailBlock[],
  {
    translator,
    footer,
    subject,
    preheader,
  }: {
    translator: Translator;
    footer: EmailFooter;
    subject: string;
    /** The preview line inbox lists show; HTML only. */
    preheader?: string | undefined;
  },
): RenderedEmail {
  const { t, locale } = translator;
  const note = t("email.footer.note");
  const inboxLink = `<a href="mailto:${escapeHtml(footer.inbox)}" style="color:${EMAIL_COLORS.white};text-decoration:underline;">${escapeHtml(footer.inbox)}</a>`;
  const siteLink = footer.siteUrl
    ? `<a href="${escapeHtml(footer.siteUrl)}" style="color:${EMAIL_COLORS.white};text-decoration:underline;">${escapeHtml(siteLabel(footer.siteUrl))}</a>`
    : null;

  const html = [
    "<!doctype html>",
    `<html lang="${locale}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light">',
    '<meta name="supported-color-schemes" content="light">',
    `<title>${escapeHtml(subject)}</title>`,
    "</head>",
    `<body style="margin:0;padding:0;background:${EMAIL_COLORS.blush};">`,
    preheader
      ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>`
      : "",
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background:${EMAIL_COLORS.blush};">`,
    '<tr><td align="center" style="padding:24px 12px;">',
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-collapse:collapse;background:${EMAIL_COLORS.white};">`,
    `<tr><td style="padding:24px 32px;background:${EMAIL_COLORS.primary};font-family:${SERIF};font-size:28px;font-weight:bold;letter-spacing:6px;color:${EMAIL_COLORS.white};">JASSMIN</td></tr>`,
    `<tr><td style="padding:32px;font-family:${SANS};font-size:16px;line-height:1.5;color:${EMAIL_COLORS.body};">`,
    "<!--content-->",
    ...blocks.map(blockHtml),
    "<!--/content-->",
    "</td></tr>",
    `<tr><td style="padding:20px 32px;background:${EMAIL_COLORS.primary};font-family:${SANS};font-size:13px;line-height:1.5;color:${EMAIL_COLORS.white};">`,
    "<!--footer-->",
    `<p style="margin:0 0 4px;">Jassmin · ${[inboxLink, siteLink].filter(Boolean).join(" · ")}</p>`,
    `<p style="margin:0;">${escapeHtml(note)}</p>`,
    "<!--/footer-->",
    "</td></tr>",
    "</table>",
    "</td></tr>",
    "</table>",
    "</body>",
    "</html>",
  ].join("\n");

  const text = [
    bodyText(blocks),
    "",
    // The standard signature separator ("-- " with its trailing space).
    "-- ",
    ["Jassmin", footer.inbox, footer.siteUrl].filter(Boolean).join(" · "),
    note,
  ].join("\n");

  return { html, text };
}

/** The domain of a sender (`"Name <a@b.c>"`, `"a@b.c"` or `{ address }`), for the Message-ID. */
export function senderDomain(from: string | { address: string }): string {
  const address = typeof from === "string" ? from : from.address;
  const match = address?.match(/@([^\s<>@]+?)>?\s*$/);
  return match?.[1]?.toLowerCase() ?? "jassmin.ua";
}

/** A new Message-ID on the sender's domain, e.g. `<…uuid…@jassmin.ua>`. */
export function createMessageId(from: string | { address: string }): string {
  return `<${randomUUID()}@${senderDomain(from)}>`;
}

export interface ComposeEmailInput {
  from: string;
  to: Mail.Options["to"];
  replyTo: Mail.Options["replyTo"];
  subject: string;
  blocks: EmailBlock[];
  translator: Translator;
  footer: EmailFooter;
  preheader?: string | undefined;
  headers?: Record<string, string> | undefined;
}

/** A complete message: HTML and text parts, Reply-To and a Message-ID on the sender's domain. */
export function composeEmail({
  from,
  to,
  replyTo,
  subject,
  blocks,
  translator,
  footer,
  preheader,
  headers,
}: ComposeEmailInput): Mail.Options & { messageId: string } {
  const { html, text } = renderEmail(blocks, { translator, footer, subject, preheader });
  return {
    from,
    to,
    replyTo,
    subject,
    messageId: createMessageId(from),
    text,
    html,
    ...(headers ? { headers } : {}),
  };
}
