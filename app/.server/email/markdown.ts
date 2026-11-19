// A newsletter's body (#181) is Strapi rich text, i.e. Markdown. Email clients need inline-styled
// HTML and a plain-text part, and the layout never takes raw HTML (`email/layout.ts`), so this
// turns the Markdown into email blocks instead: paragraphs and quotes become `rich` blocks,
// headings `heading` blocks and lists `list` blocks, with bold, italic and links kept. Images,
// raw HTML, code blocks, tables and rules are dropped; product cards carry the newsletter's photos.
import { Lexer, type Token, type Tokens } from "marked";
import type { EmailBlock, EmailRun } from "./layout";

/** What a link's `href` becomes, e.g. the shop's links with the newsletter's UTM tags. */
export type LinkTransform = (href: string) => string;

interface RunStyle {
  strong?: boolean;
  em?: boolean;
  href?: string;
}

/** Soft line breaks read as spaces, as on the site (`renderMarkdown` has `breaks: false`). */
const softBreaks = (text: string): string => text.replace(/[ \t]*\r?\n[ \t]*/g, " ");

function inlineRuns(tokens: Token[] | undefined, style: RunStyle, link: LinkTransform): EmailRun[] {
  const runs: EmailRun[] = [];
  const push = (text: string) => {
    if (text === "") return;
    runs.push({
      text,
      ...(style.strong ? { strong: true } : {}),
      ...(style.em ? { em: true } : {}),
      ...(style.href ? { href: style.href } : {}),
    });
  };
  for (const token of tokens ?? []) {
    switch (token.type) {
      case "text":
      case "escape": {
        const nested = (token as Tokens.Text).tokens;
        if (nested && nested.length > 0) {
          runs.push(...inlineRuns(nested, style, link));
        } else {
          push(softBreaks(token.text));
        }
        break;
      }
      case "codespan":
        push(softBreaks(token.text));
        break;
      case "br":
        push("\n");
        break;
      case "strong":
        runs.push(...inlineRuns(token.tokens, { ...style, strong: true }, link));
        break;
      case "em":
        runs.push(...inlineRuns(token.tokens, { ...style, em: true }, link));
        break;
      case "del":
        runs.push(...inlineRuns(token.tokens, style, link));
        break;
      case "link": {
        const { href } = token as Tokens.Link;
        // A link inside a link keeps the outer one; a link without a target is its text.
        const target = style.href ?? (href ? link(href) : undefined);
        runs.push(
          ...inlineRuns(token.tokens, { ...style, ...(target ? { href: target } : {}) }, link),
        );
        break;
      }
      default:
        // Images and raw HTML are dropped.
        break;
    }
  }
  return runs;
}

const sameStyle = (a: EmailRun, b: EmailRun): boolean =>
  a.strong === b.strong && a.em === b.em && a.href === b.href;

/** Neighbouring runs with the same formatting joined into one. */
function mergeRuns(runs: EmailRun[]): EmailRun[] {
  const merged: EmailRun[] = [];
  for (const run of runs) {
    const last = merged.at(-1);
    if (last && sameStyle(last, run)) {
      last.text += run.text;
    } else {
      merged.push({ ...run });
    }
  }
  return merged;
}

/**
 * Runs joined where their formatting matches, without leading or trailing whitespace; `null` when
 * nothing is left.
 */
function trimRuns(runs: EmailRun[]): EmailRun[] | null {
  const copy = mergeRuns(runs);
  while (copy[0] && copy[0].text.trim() === "") copy.shift();
  while (copy.at(-1)?.text.trim() === "") copy.pop();
  const first = copy[0];
  const last = copy.at(-1);
  if (!first || !last) return null;
  first.text = first.text.trimStart();
  last.text = last.text.trimEnd();
  return copy;
}

/** A list item's runs: its text and paragraphs, one line each; nested lists are flattened in. */
function itemRuns(item: Tokens.ListItem, link: LinkTransform): EmailRun[] {
  const runs: EmailRun[] = [];
  for (const token of item.tokens) {
    let part: EmailRun[] = [];
    if (token.type === "text" || token.type === "paragraph") {
      part = inlineRuns((token as Tokens.Text).tokens ?? [token], {}, link);
    } else if (token.type === "list") {
      part = (token as Tokens.List).items.flatMap((nested, index) => [
        ...(index > 0 ? [{ text: "; " }] : []),
        ...itemRuns(nested, link),
      ]);
    }
    const trimmed = trimRuns(part);
    if (trimmed) {
      if (runs.length > 0) runs.push({ text: "\n" });
      runs.push(...trimmed);
    }
  }
  return runs;
}

function blocksOf(tokens: Token[], link: LinkTransform): EmailBlock[] {
  const blocks: EmailBlock[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case "paragraph": {
        const runs = trimRuns(inlineRuns(token.tokens, {}, link));
        if (runs) blocks.push({ type: "rich", runs });
        break;
      }
      case "heading": {
        const text = trimRuns(inlineRuns(token.tokens, {}, link))
          ?.map((run) => run.text)
          .join("");
        if (text) blocks.push({ type: "heading", text });
        break;
      }
      case "list": {
        const list = token as Tokens.List;
        const items = list.items
          .map((item) => itemRuns(item, link))
          .filter((runs) => runs.length > 0);
        if (items.length > 0) blocks.push({ type: "list", ordered: list.ordered, items });
        break;
      }
      case "blockquote":
        blocks.push(...blocksOf(token.tokens ?? [], link));
        break;
      default:
        // Code blocks, raw HTML, tables, rules and spaces are dropped.
        break;
    }
  }
  return blocks;
}

/** The email blocks of a Markdown text; every link's `href` goes through `link`. */
export function markdownToEmailBlocks(
  markdown: string,
  link: LinkTransform = (href) => href,
): EmailBlock[] {
  return blocksOf(Lexer.lex(markdown, { gfm: true, breaks: false }), link);
}
