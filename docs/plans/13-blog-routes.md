# Plan: Add public blog listing and article routes backed by Strapi (#13)

Issue: https://github.com/savchukolgaa/jassmin/issues/13
Branch: `issue/13`
Worktree: `.claude/worktrees/issue-13`
Status: Planned

## Goal
A visitor can read fragrance articles and scent guides on the site. `/blog` lists published Strapi
posts newest first with pagination, and `/blog/:slug` renders one article server-side with sanitized
Markdown content and SEO/Open Graph meta tags. Drafts and unknown slugs return 404, and a Strapi
outage shows a 503.

## Dependencies & prerequisites
- **#6 (closed, on `origin/main`)**: the `_shop` layout, header/footer and the route skeleton.
  `app/routes.ts` already registers `blog` → `routes/blog.tsx` and `blog/:slug` →
  `routes/blog-post.tsx` as placeholders, and the footer links to `/blog` (`BLOG_LINK` in
  `app/components/layout/nav.ts`).
- **#20 (closed, on `origin/main`)**: Strapi in `cms/`, the server-only client and the content API.
  Everything this issue needs exists already:
  - `listBlogPosts({ page, pageSize })` and `getBlogPostBySlug(slug)` in
    `app/.server/cms/content.ts` (newest first by `publishedAt:desc`, `status=published` always
    added by `cmsFetch`, media URLs absolute, `null` for a missing slug).
  - DTOs `BlogPostSummary`, `BlogPost`, `Seo`, `CmsImage`, `Paginated<T>` in `app/lib/cms.ts`.
  - `CmsError` and `cmsUnavailable` (→ 503) in `app/.server/cms/errors.ts`; the 503 text in
    `describeRouteError` (`app/lib/route-error.ts`), rendered by the `_shop` `ErrorBoundary`.
  - `renderMarkdown` / `toPlainText` in `app/.server/markdown.ts` and `RichText` in
    `app/components/ui/RichText.tsx`.
  - Fixtures `blog-posts.json`, `blog-posts-empty.json` and `blog-post-by-slug.json` in
    `app/.server/cms/__fixtures__/`, and `pnpm cms:seed` creates two published posts and a draft.
- **No new packages** (`marked` and `sanitize-html` are already dependencies), **no new env vars**.
- **No database migration.** Blog content lives in Strapi, so this issue doesn't touch
  `app/.server/db/`. #5, #26 and #14 are being planned in parallel and each adds a Drizzle migration.
  If this branch is later changed to need one, or if a rebase onto `origin/main` brings in one of
  theirs while a migration of ours is unmerged, **delete our generated migration and its snapshot,
  rebase, and regenerate it with `pnpm db:generate --name <name>`** (plus its rollback in
  `db/rollbacks/<tag>.sql`), so the `_journal.json` order and snapshots stay consistent. As planned,
  rebasing #13 only needs a normal `git rebase origin/main`.

## Decisions & assumptions
- **Keep the existing route files** `app/routes/blog.tsx` and `app/routes/blog-post.tsx` instead of
  the issue's `blog._index.tsx` / `blog.$slug.tsx` names: routes are declared explicitly in
  `app/routes.ts` (not file-based), and `app/routes.test.ts` already covers these paths.
- **A blog view layer like the home page's.** `app/.server/services/blog.ts` turns the CMS DTOs
  into plain view objects (`BlogListView`, `BlogPostView` in `app/lib/blog.ts`), the same way
  `buildHomePageView` does for `/`. Loaders stay thin and the mapping is unit-testable without
  Strapi.
- **A separate Markdown profile for articles.** `renderMarkdown` only allows `h3`/`h4` and no images,
  which suits short home page copy. Articles use `##` headings (see the fixture) and may contain
  inline images. Add `renderArticleMarkdown(markdown, { mediaBaseUrl })` in `app/.server/markdown.ts`
  that shares the marked instance and link handling and also allows `h2`, `hr`, `code`, `pre`,
  `del` and `img` (`src`, `alt`, `title`, `width`, `height`; schemes `http`/`https` only). An `img`
  `transformTags` hook resolves relative Strapi paths (`/uploads/…`) against `STRAPI_URL` and adds
  `loading="lazy"` and `decoding="async"`. The `h1` stays the article title, so a `#` heading in the
  content is downgraded to `h2`. `renderMarkdown` itself doesn't change.
- **`RichText` gets an `article` variant** (or the route passes a `className`) with styles for
  `h2`, `img` (rounded, full width), `hr`, `code`/`pre`, using the C+ tokens (`ink`, `body`,
  `line`, `card`, `primary-dark` links).
- **Page param**: `?page=` is parsed with zod in `app/lib/blog.ts` (`parseBlogSearch`), coercing to
  an int in 1–10 000 and falling back to 1 on bad input, like `parseCatalogSearch`. Page size is
  `BLOG_PAGE_SIZE = 12` (same as `DEFAULT_PAGE_SIZE` in `cms/content.ts`).
- **Page past the end → 404** when there are posts (`page > pageCount && total > 0`). With no posts
  at all, page 1 shows an empty state ("No articles yet") with a link to the catalogs.
- **Slug param**: checked against Strapi's UID alphabet (`/^[A-Za-z0-9._~-]{1,200}$/`) before
  calling Strapi; anything else is a 404 without a network call. `getBlogPostBySlug` returns `null`
  for drafts, because `cmsFetch` always sends `status=published`, so drafts are 404s too.
- **Pagination component**: generalize `app/features/catalog/Pagination.tsx` into
  `app/components/ui/Pagination.tsx` with a `hrefForPage(page: number) => string` prop, and have the
  catalog pass `(p) => catalogHref(pathname, search, p)`. Catalog markup and behaviour stay the
  same; the blog passes `blogHref`. No second, copy-pasted pagination.
- **Dates** are formatted on the server in the view (`Intl.DateTimeFormat("en-GB", { dateStyle:
  "long", timeZone: "Europe/Kyiv" })`, e.g. "22 October 2026"), with a `<time dateTime>` holding the
  ISO value, so server and client output can't differ. UI copy is in English like the rest of the
  storefront.
- **Meta** on `/blog/:slug`: `title` = `seo.metaTitle ?? post.title` + " — Jassmin";
  `description` = `seo.metaDescription ?? excerpt ?? toPlainText(content)`; `og:type` = `article`,
  `og:title`, `og:description`, `og:image` = `seo.ogImage ?? coverImage` (absolute URLs from the
  CMS client), `og:url` and `<link rel="canonical">` from the request origin + `/blog/<slug>`,
  `article:published_time`, and `twitter:card` = `summary_large_image` when there's an image. `meta`
  falls back to a generic title when `loaderData` is missing (404/503). `/blog` gets a static title,
  description and `og:type=website`; pages > 1 get "— Page N" in the title and their own canonical.
- **Caching** (`headers` export, issue says "consider"): the document includes the per-visitor
  header (cart count, login state from the `_shop` loader), so a shared cache must never store it.
  Loaders set `Cache-Control: public, max-age=60, stale-while-revalidate=300` only when the request
  has no `__jassmin_session` cookie (crawlers, first-time visitors) and `private, no-cache`
  otherwise, always with `Vary: Cookie`; the route `headers` export forwards `loaderHeaders`. 404 and
  503 responses aren't cached (`no-store`).
  - *Implementation note:* the cookie name moved to `app/.server/session-cookie.ts`
    (`SESSION_COOKIE_NAME`, `hasSessionCookie`) because `session.ts` validates the env on import,
    which would make the cache helper and the route tests need a database URL. The `headers` export
    uses `blogResponseHeaders(loaderHeaders)` from `app/lib/blog.ts`, which returns `no-store` when
    the loader threw (no `Cache-Control` of its own).
- **Card UI**: blog cards follow the C+ tokens (`rounded-card`, `bg-card`, the `lift` motion from
  `docs/design.md`, Manrope 800 headings, `text-primary-dark` for links). There is no blog page on
  the design canvas yet, so the list and article reuse the catalog page's spacing and heading style.
- **Images**: cover images use `CmsImage.url`, `srcSet`, `width`/`height` (prevents layout shift)
  and `alt` (empty alt falls back to `""` = decorative, since the title is right next to it). The
  article cover loads eagerly, list covers lazily. No cover → a blush placeholder block.

## Resolved questions
- **Q1: Cache policy** — Use the cookie-aware policy: `public, max-age=60, stale-while-revalidate=300`
  only without a `__jassmin_session` cookie, `private, no-cache` with one, always `Vary: Cookie`;
  404/503 are `no-store` (source: user answer, 2026-10-23).
- **Q2: Date format and UI language** — English copy, `en-GB` long dates in Europe/Kyiv time, e.g.
  "22 October 2026" (source: user answer, 2026-10-23).
- **Q3: Related articles / product links on the article page** — No; only a "Back to the blog" link
  (source: user answer, 2026-10-23).
- **Do the CMS functions and DTOs exist?** — Yes, `listBlogPosts` / `getBlogPostBySlug` with
  absolute media URLs and published-only filtering (source: `app/.server/cms/content.ts`,
  `app/.server/cms/client.ts`, #20).
- **How are drafts excluded?** — `cmsFetch` always adds `status=published`, so a draft slug returns
  `null` → 404 (source: `app/.server/AGENTS.md`, `app/.server/cms/client.ts`).
- **How does a Strapi outage become a 503?** — `.catch(cmsUnavailable)` in the loader; the `_shop`
  `ErrorBoundary` renders `describeRouteError`'s 503 text and keeps the header (source:
  `app/.server/cms/errors.ts`, `app/routes/_shop.tsx`, `app/routes/home.tsx`).
- **How is Markdown sanitized?** — `marked` + `sanitize-html` on the server, injected only through
  `RichText` (source: `app/.server/markdown.ts`, `app/.server/AGENTS.md`). The article profile
  extends this rather than adding a library.
- **Route file names / paths** — already registered as `routes/blog.tsx` and
  `routes/blog-post.tsx` (source: `app/routes.ts`, `app/routes.test.ts`, #6).
- **Does the blog need a link in the header?** — No: #6's header spec has no blog item; the footer
  already links to `/blog` (source: #6, `app/components/layout/nav.ts`).
- **Does this issue add a DB migration?** — No; content is in Strapi (source: #20). See the rebase
  note under Dependencies for the parallel #5/#26/#14 migrations.

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/.server/markdown.ts` | Add `renderArticleMarkdown` (h2, img, code, hr; absolute image URLs) |
| modify | `app/.server/markdown.test.ts` | Tests for the article profile |
| create | `app/lib/blog.ts` | `BLOG_PAGE_SIZE`, `parseBlogSearch`, `blogHref`, `isBlogSlug`, `BlogListView`, `BlogPostView`, `DEFAULT_BLOG_DESCRIPTION` |
| create | `app/lib/blog.test.ts` | Param parsing, href and slug tests |
| create | `app/.server/services/blog.ts` | `buildBlogListView`, `buildBlogPostView` (HTML, dates, SEO fallbacks), `blogCacheHeaders(request)` |
| create | `app/.server/session-cookie.ts` | `SESSION_COOKIE_NAME`, `hasSessionCookie(request)` (env-free) |
| modify | `app/.server/session.ts` | Use `SESSION_COOKIE_NAME` |
| create | `app/.server/services/blog.test.ts` | Mapping, SEO fallback and cache header tests (fixture-based DTOs) |
| create | `app/components/ui/Pagination.tsx` | Generic pagination (moved from catalog, `hrefForPage` prop) |
| delete | `app/features/catalog/Pagination.tsx` | Replaced by the generic one |
| modify | `app/routes/catalog.tsx` | Use the generic `Pagination` |
| create | `app/components/ui/Pagination.test.ts` | Pagination tests (moved from `catalog-ui.test.ts`, plus blog links) |
| modify | `app/features/catalog/catalog-ui.test.ts` | Drop the moved Pagination tests |
| modify | `app/components/ui/RichText.tsx` | `variant="article"` styles for h2, img, hr, code |
| create | `app/features/blog/BlogPostCard.tsx` | Card for the list: cover, date, title, excerpt |
| create | `app/features/blog/BlogCover.tsx` | Cover image with srcset / placeholder |
| create | `app/features/blog/BlogArticle.tsx` | Article layout: title, meta line, cover, `RichText` |
| modify | `app/routes/blog.tsx` | Loader, meta, headers, list UI, ErrorBoundary |
| modify | `app/routes/blog-post.tsx` | Loader, meta, headers, article UI, ErrorBoundary |
| create | `app/routes/blog.test.ts` | Loader tests with mocked `~/.server/cms/content` |
| create | `app/routes/blog-post.test.ts` | Loader + meta tests with mocked `~/.server/cms/content` |

## Steps
- [x] **1. Article Markdown profile** — In `app/.server/markdown.ts`, add
  `renderArticleMarkdown(markdown: string, options: { mediaBaseUrl: string }): string`. Build its
  `sanitize-html` options from the existing ones (same link transform, `allowProtocolRelative:
  false`) plus `h2`, `hr`, `code`, `pre`, `del`, `img`; `transformTags.h1` → `h2`;
  `transformTags.img` resolves `src` with `new URL(src, mediaBaseUrl)` (drop the tag's `src` if it
  throws) and adds `loading="lazy" decoding="async"`; `allowedSchemesByTag: { img: ["http",
  "https"] }`. Tests: `## Heading` → `<h2>`, `# Title` → `<h2>`, `![a](/uploads/x.jpg)` →
  absolute `src` on the CMS origin, `javascript:`/`data:` image `src` and `onerror` are stripped,
  `<script>`/`<iframe>`/`style` attributes are stripped, code blocks are escaped. `pnpm test`.
- [x] **2. Shared blog helpers in `app/lib/blog.ts`** — `BLOG_PAGE_SIZE = 12`;
  `parseBlogSearch(params): { page: number }` (zod, `.catch(1)`); `blogHref(page)` (`/blog` for 1,
  `/blog?page=N` otherwise); `blogPostHref(slug)`; `isBlogSlug(value)`;
  `DEFAULT_BLOG_DESCRIPTION`; view types `BlogPostCardView` (slug, title, excerpt, coverImage,
  `publishedAt` ISO, `publishedLabel`), `BlogListView` (`posts`, `page`, `pageCount`, `total`),
  `BlogPostView` (card fields + `authorName`, `contentHtml`, `seo: { title, description, image,
  canonicalUrl }`). Isomorphic: no server imports. Unit tests in `app/lib/blog.test.ts`.
- [x] **3. Blog view service** — `app/.server/services/blog.ts`:
  `buildBlogListView(paginated: Paginated<BlogPostSummary>)` and
  `buildBlogPostView(post: BlogPost, { origin, mediaBaseUrl })` using `renderArticleMarkdown`,
  `toPlainText` and the date formatter from Decisions; SEO fallbacks
  `metaTitle → title`, `metaDescription → excerpt → toPlainText(content) → DEFAULT_BLOG_DESCRIPTION`,
  `ogImage → coverImage → null`. Add `blogCacheHeaders(request)` returning the `Cache-Control` /
  `Vary` headers from Decisions. Tests build DTOs from the recorded fixtures via `toBlogPost` /
  `toBlogPostSummary` (from `cms/content.ts`), covering each fallback and both cache branches.
- [x] **4. Generic `Pagination`** — Move `app/features/catalog/Pagination.tsx` to
  `app/components/ui/Pagination.tsx` with props `{ page, pageCount, hrefForPage }` and update
  `app/routes/catalog.tsx`. Behaviour and classes unchanged. `pnpm typecheck && pnpm test`, and
  check `/catalog/women?page=2` still paginates.
- [ ] **5. `/blog` list route** — `app/routes/blog.tsx`:
  - `loader({ request })`: `parseBlogSearch`, `listBlogPosts({ page, pageSize: BLOG_PAGE_SIZE })
    .catch(cmsUnavailable)`; `throw data(null, { status: 404 })` when `page > pageCount &&
    total > 0`; return `data(buildBlogListView(…), { headers: blogCacheHeaders(request) })`.
  - `headers({ loaderHeaders })` forwards `Cache-Control` and `Vary`.
  - `meta`: "Blog — Jassmin" (+ " — Page N"), description, `og:type=website`, `og:title`.
  - UI in `<main className="container mx-auto px-4 pt-10 pb-16">`: `h1` "Blog" in the catalog
    heading style, intro line, a `ul` grid (`sm:grid-cols-2 lg:grid-cols-3`) of `BlogPostCard`s,
    empty state, `Pagination` with `blogHref`. Dim the grid while a page change loads (same
    `useNavigation` pattern as the catalog).
  - `ErrorBoundary` → `ErrorContent` + `describeRouteError` (the `_shop` boundary would also work,
    but a route boundary matches `catalog.tsx`).
- [ ] **6. `/blog/:slug` article route** — `app/routes/blog-post.tsx`:
  - `loader({ params, request })`: `isBlogSlug(params.slug)` else 404; `getBlogPostBySlug(slug)
    .catch(cmsUnavailable)`; `null` → `throw data(null, { status: 404 })`; return
    `data(buildBlogPostView(post, { origin: new URL(request.url).origin, mediaBaseUrl:
    getEnv().STRAPI_URL }), { headers: blogCacheHeaders(request) })`.
  - `headers` forwards the loader's headers.
  - `meta` from `loaderData.seo` as listed in Decisions, plus `{ tagName: "link", rel: "canonical",
    href }`; fallback "Article not found — Jassmin" without `loaderData`.
  - UI via `BlogArticle`: back link to `/blog`, `h1`, `<time>` + author, cover (eager, `srcSet`,
    `sizes`), `RichText variant="article"` in a `max-w-prose` column.
  - `ErrorBoundary` with a "Back to the blog" link inside `ErrorContent`.
- [ ] **7. Blog UI components** — `BlogCover` (aspect 3/2, `rounded-card`, `object-cover`,
  `width`/`height`/`srcSet`/`sizes`, blush placeholder), `BlogPostCard` (whole card is one link
  with a visible focus ring from `focusRing("onLight")`, `lift` hover with
  `motion-reduce:transform-none`), `BlogArticle`. Add the `article` variant to `RichText`.
  Check contrast follows `docs/design.md` (text `ink`/`body`/`muted`, links `primary-dark`).
- [ ] **8. Route tests** — `app/routes/blog.test.ts` and `app/routes/blog-post.test.ts`, mocking
  `~/.server/cms/content` with `vi.hoisted` like `app/routes/home.test.ts`:
  list returns posts in the order given and passes `page`/`pageSize`; `?page=abc` → page 1; page
  past the end → 404; empty list on page 1 is not a 404; `CmsError` → 503; slug lookup `null` → 404;
  invalid slug → 404 without calling `getBlogPostBySlug`; draft (mock returns `null`, the
  published-only filter is covered by `cms/client.test.ts`) → 404; article `contentHtml` has no
  `<script>`; `meta` contains `og:title`, `og:description`, `og:image`, canonical; headers include
  `Vary: Cookie`.
- [ ] **9. Manual check & finish** — `pnpm aspire run` (with `pnpm cms:seed` done), open `/blog`,
  `/blog?page=2` (404 with two posts), the seeded article, the draft's slug (404) and
  `/blog/does-not-exist` (404). `curl -s http://localhost:<port>/blog/how-to-choose-a-perfume` and
  check the article text, `<title>`, `og:*` and canonical tags are in the raw HTML; `curl -I` for
  `Cache-Control`/`Vary`. Stop the `cms` resource in the Aspire dashboard and reload → 503 page
  with the header. Check 375 px width. Then `pnpm typecheck`, `pnpm lint`, `pnpm test`,
  `pnpm build`.

## Testing & verification
- Unit: `app/.server/markdown.test.ts` (article profile, XSS cases), `app/lib/blog.test.ts`,
  `app/.server/services/blog.test.ts` (fixture-based mapping, SEO fallbacks, cache headers).
- Route: `app/routes/blog.test.ts`, `app/routes/blog-post.test.ts` (mocked CMS: ordering,
  pagination, 404s, 503, meta, headers).
- Existing tests that must still pass: `app/routes.test.ts`, `app/.server/cms/*.test.ts`, catalog
  UI tests after the `Pagination` move.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual: as in step 9 (SSR HTML via `curl`, 404s, 503 with Strapi stopped, mobile width).

## Acceptance criteria
- [ ] Blog list shows published Strapi posts newest first with pagination — steps 2, 4, 5, 8
- [ ] Draft (unpublished) posts never appear and their slugs return 404 — steps 5, 6, 8, 9
- [ ] Article content and meta tags are present in the server-rendered HTML — steps 3, 6, 9
- [ ] Unknown slugs show a 404 page — steps 6, 8, 9
- [ ] Rendered content is sanitized — steps 1, 3, 8

## Out of scope
- Changes to the Strapi content model, client or fixtures (#20), and Strapi webhooks / cache
  invalidation.
- Blog search, tags/categories, related posts, comments, RSS, sitemap and JSON-LD structured data.
- A header nav item for the blog (#6 doesn't specify one; the footer already links it).
- Analytics events for article views (#18).
- Any database schema or migration change.
