# Plan: Use the generated label card as the share image for products without a photo (#105)

Issue: https://github.com/savchukolgaa/jassmin/issues/105
Branch: `issue/105`
Worktree: `.claude/worktrees/issue-105`
Status: Planned

## Goal
When a customer shares a perfume that has no photo in a messenger, the link preview should show
that perfume's own generated label card (#99), not the generic `/og-default.jpg`. A
language-neutral, cached resource route renders the card as a 1200×630 PNG. The product page's
`meta` uses that route as `og:image` whenever `product.image` is `null`.

## Dependencies & prerequisites
- #99 (label card): done on `origin/main`. `app/lib/label-art.ts` (`labelPalette`, `labelVariant`,
  `layoutLabelText`) and `app/features/catalog/ProductLabelArt.tsx` exist.
- #85 (share metadata): done. `seoMeta` / `buildSeoMeta` in `app/lib/seo.ts` already make
  `image.url` absolute and emit `og:image:width/height/alt`.
- #83 (slugs, `resolveProductHandle`) and #88 (archived products): done.
- **New packages** (`pnpm add`):
  - `@resvg/resvg-js`: SVG → PNG, a napi-rs native addon with prebuilt per-platform binaries in
    `optionalDependencies` and no install script, so `allowBuilds` doesn't need a change. The spike
    in step 1 checks this.
  - `@fontsource/playfair-display` and `@fontsource/manrope`: the static (non-variable) builds of
    the same fonts, for their WOFF files at the exact weights. The "Decisions" section explains why.
    They're imported only under `app/.server/`, never into the client bundle.
- No env vars, no migrations.

## Decisions & assumptions
- **Rasteriser: `@resvg/resvg-js` on the card's own SVG, not satori.** The card is already SVG
  with `<text>` placed by `layoutLabelText`. resvg renders it directly with fonts we pass in
  (`font.fontBuffers`, `loadSystemFonts: false`), so the PNG matches the site and the
  palette, bottle and text layout code isn't duplicated. Satori lays out HTML/flexbox and turns only
  its own text into paths. It can't typeset `<text>` inside an embedded SVG, so the brand and name
  layout would have to be rebuilt as positioned boxes.
- **The OG SVG reuses `ProductLabelArt`**, rendered with `react-dom/server`'s
  `renderToStaticMarkup`. resvg can't resolve `var(--font-sans)`, so the component gets an
  optional `fonts?: { sans: string; serif: string }` prop. The default stays the CSS variables,
  so the site's markup doesn't change, and the OG renderer passes the literal family names. The
  component's geometry and text logic stay in one place.
- **Static fonts instead of `@fontsource-variable/*` (deviation from the issue text).** The
  variable packages ship only WOFF2 variable fonts. resvg/fontdb reads only TTF/OTF, and WOFF2
  needs a glyph-table reconstruction (`wawoff2` or similar) as well as Brotli. Variable fonts in
  resvg also aren't reliably instanced at a weight: we need Playfair 700 and Manrope 800, and
  could get the default instance instead. The static `@fontsource/*` packages ship WOFF1 files per
  weight and subset. WOFF1 → SFNT takes about 40 lines with `node:zlib` (inflate each table and
  rebuild the table directory), in `app/.server/og/woff.ts`. We load the `latin`, `latin-ext`,
  `cyrillic` and `cyrillic-ext` subsets of Playfair Display 700 and Manrope 800. The fonts are the
  same, so the card looks the same. **(unconfirmed, see Q2)**
- **Route path: `og/products/:file`, with the loader requiring a `.png` suffix.** React Router
  dynamic segments can't be partial (`:handle.png` isn't a param plus a suffix). The loader strips
  `.png` and answers 404 for any other name. The public URL is still `/og/products/<handle>.png`.
- **Handle resolution: `resolveProductHandle(handle, DEFAULT_LOCALE)`.** The card has no
  translated copy, so the locale doesn't matter.
  - `null` → 404.
  - `kind: "product"` with `available: false` (archived) → 404.
  - `kind: "redirect"` (UUID of a product that has a slug, or a former slug) → 301 to
    `/og/products/<current slug>.png`. Crawlers follow redirects, and the cache keeps one entry per
    product.
  - A product *with* a photo still gets a card from this route. Only `meta` decides when to use it.
- **`updatedAt` for the ETag.** `ProductDetail` doesn't carry `updated_at`, so we add
  `updatedAt: Date` to the server-only `kind: "product"` result of `resolveProductHandle`, next to
  `id`. Its select (`findProductByPublicId` / `findProductBySlug` in
  `app/.server/db/queries/products.ts`) gains `updatedAt: products.updatedAt`. CMS edits rewrite
  the products row, and `updatedAt()`'s `$onUpdate` refreshes it, so a renamed product or one with
  a new family gets a new ETag.
- **ETag** = `"<publicId>-<updatedAt ms base36>-v<CARD_VERSION>"`, a strong ETag. `CARD_VERSION`
  is a constant in `label-card.ts`. Bumping it changes every ETag when the card design changes.
  `If-None-Match` is parsed as a comma list (`*`, `W/` prefixes allowed). A match returns 304 with
  the same `ETag` and `Cache-Control` and no body.
- **In-memory cache**: a small LRU `Map` in `app/.server/og/label-card-cache.ts`, keyed on
  `publicId + updatedAt`, holding at most 256 entries. ~140 products at roughly 30–80 KB per PNG
  is a few MB. It stores the render *promise*, so concurrent crawler hits share one render, and it
  drops a rejected promise. The ETag/304 check runs before any render.
- **Card layout (1200×630)** **(unconfirmed, see Q1)**: the full 4:5 card (504×630, with its own
  brand, name and wordmark exactly as on the site) fills the left edge. The remaining 696×630 is
  `palette.bg` and holds three things: the brand in Manrope 800 capitals with letter-spacing in
  `palette.mark`; the name in Playfair Display 700, set by `layoutLabelText` (width ≈ 560,
  `maxLines: 3`, sizes `[72, 60, 50, 42]`) in `palette.mark`; and a "jassmin." wordmark at the
  bottom. Messengers show the preview small, so the large text keeps the name legible where the
  label on the bottle isn't. `"jassmin."` is the brand mark already used in the card, not
  translatable copy, so it needs no i18n key.
- **Response headers**: `Content-Type: image/png`,
  `Cache-Control: public, max-age=86400, stale-while-revalidate=604800`, `ETag`. A 404 sends a
  short `Cache-Control: public, max-age=300`, so a new product isn't cached as missing for long.
- `robots.txt` (`app/.server/seo/robots.ts`) doesn't disallow `/og/`, so crawlers that respect
  robots can fetch it. No change needed.
- `meta` builds the URL with a new isomorphic helper `productShareImagePath(product)` in
  `app/lib/products.ts`. It returns `/og/products/${product.slug ?? product.id}.png`, the same
  handle as `productHref`, and `seoMeta` makes it absolute.

## Open questions
- [ ] **Q1: Is "card on the left + large brand/name on the right" the layout you want?** Why it
  matters: the alternatives are the card centred alone on `palette.bg`, which is simpler but
  leaves the name tiny in a messenger thumbnail, or the card without text plus big text. Recommended
  default: card left with its full label, large brand and name and "jassmin." on the right.
  Affects steps: 4.
- [ ] **Q2: Is it OK to add the static `@fontsource/playfair-display` and `@fontsource/manrope`
  packages (server-only) next to the variable ones?** Why it matters: the issue says to load the
  `@fontsource-variable` files. Those are WOFF2 variable fonts, which resvg can't load or render
  at weight 700/800 without an extra WOFF2 decoder and variable-font instancing. Recommended
  default: add the static packages. If you'd rather not, the fallback is `wawoff2` for WOFF2
  decoding and testing whether resvg renders the weights correctly in the step 1 spike. Affects
  steps: 1, 3.

## Resolved questions
- **Which library?** `@resvg/resvg-js` rendering the existing SVG. The issue names satori + resvg
  only as an option ("can do this"), and reusing `ProductLabelArt` avoids duplicating the layout
  (source: #105 Context, `app/features/catalog/ProductLabelArt.tsx`).
- **Can the route be `:handle.png`?** No. React Router segments are whole, so the route is
  `og/products/:file` and the loader checks the suffix (source: `app/routes.ts` patterns,
  React Router path matching).
- **Where does `updated_at` come from?** From `products.updated_at`, refreshed on every update
  (source: `app/.server/db/schema.ts` `updatedAt()` / `products`, `schema.test.ts` "refreshes
  updated_at on update"). It isn't in `ProductDetail` yet, so it's added to the server-only
  handle result.
- **Archived products?** `resolveProductHandle` returns them with `available: false` (#88), and
  the issue wants 404 for them (source: `app/.server/services/products.ts`, #105 Technical).
- **Does the production runtime support a native addon?** Yes. `pnpm start` is
  `react-router-serve` on Node with `node_modules` present, and `@node-rs/argon2` (also napi-rs)
  already works in it. React Router's SSR build externalises `node_modules` dependencies (source:
  `package.json`, `app/.server/password.ts`). Step 1 and step 8 verify this.
- **Do fonts need to be bundled into the build?** No. They're read at runtime from
  `node_modules` via `createRequire(import.meta.url).resolve(...)`, like any server dependency.
- **Does the route need the shop layout, session or consent?** No. It's a top-level resource
  route, like `sitemap.xml` and `robots.txt` (source: `app/routes.ts`).
- **Is there new user-facing copy?** No. The card has no translated text (#105), so there are no
  i18n keys.

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `package.json`, `pnpm-lock.yaml` | add `@resvg/resvg-js`, `@fontsource/playfair-display`, `@fontsource/manrope` |
| create | `app/.server/og/woff.ts` (+ `.test.ts`) | WOFF1 → TTF/OTF (SFNT) conversion with `node:zlib` |
| create | `app/.server/og/fonts.ts` (+ `.test.ts`) | resolve, convert and memoise the font buffers; export the family names |
| create | `app/.server/og/label-card.ts` (+ `.test.ts`) | `labelCardSvg(label)` (1200×630 SVG string) and `renderLabelCardPng(label)` (resvg), `CARD_VERSION`, `labelCardEtag` |
| create | `app/.server/og/label-card-cache.ts` (+ `.test.ts`) | small LRU of render promises |
| modify | `app/features/catalog/ProductLabelArt.tsx` (+ test) | optional `fonts` prop; `fontFamily` from it |
| modify | `app/.server/db/queries/products.ts` | select `updatedAt` in the detail row |
| modify | `app/.server/services/products.ts` (+ test) | `updatedAt` on the `kind: "product"` result |
| create | `app/routes/og.products.$file.ts` (+ `.test.ts`) | the resource route loader |
| modify | `app/routes.ts` | `route("og/products/:file", "routes/og.products.$file.ts")` |
| modify | `app/lib/products.ts` (+ test) | `productShareImagePath(product)` |
| modify | `app/routes/product.tsx`, `app/routes/product.test.ts` | `meta` image fallback to the generated PNG |
| modify | `docs/design.md` | a line under "Label card palette" about the share image |

## Steps

- [ ] **1. Spike: add the dependencies and prove the pipeline.** `pnpm add @resvg/resvg-js
  @fontsource/playfair-display @fontsource/manrope`. In a throwaway script in the scratchpad (not
  committed), convert one WOFF to SFNT and render
  `<svg><text font-family="Playfair Display" font-weight="700">Жасмин Jasmine</text></svg>` with
  `new Resvg(svg, { font: { fontBuffers, loadSystemFonts: false, defaultFontFamily: "Manrope" } })`.
  Confirm three things: Cyrillic and Latin glyphs both render when each subset is a separate
  buffer (fontdb falls back per character across faces); 700/800 come out bold; and the package's
  `files/*.woff` paths resolve via `createRequire` (check its `exports`). Check that `pnpm install`
  printed no "ignored build scripts" warning for resvg. If something fails, take the Q2 fallback
  and note it in the plan.

- [ ] **2. `woff.ts`: WOFF1 → SFNT.** `export function woffToSfnt(woff: Buffer): Buffer`. It does
  the following:
  - check the `wOFF` signature;
  - read `flavor`, `numTables` and the 20-byte table directory entries (tag, offset, compLength,
    origLength, origChecksum);
  - `inflateSync` each table where `compLength < origLength`;
  - write the SFNT header (`searchRange`, `entrySelector`, `rangeShift`), then 16-byte table
    records with 4-byte-aligned offsets, then the padded tables.

  It throws on a bad signature: fonts are build inputs, not user input. Tests: a real
  `@fontsource/manrope` WOFF converts to a buffer starting with `0x00010000`, with `numTables`
  matching and each table's offset/length inside the buffer; a non-WOFF buffer throws.

- [ ] **3. `fonts.ts`: load the fonts once.** `export const OG_FONTS = { sans: "Manrope", serif:
  "Playfair Display" }` and `export function ogFontBuffers(): Buffer[]`, memoised. It resolves
  `@fontsource/playfair-display/files/playfair-display-{latin,latin-ext,cyrillic,cyrillic-ext}-700-normal.woff`
  and `@fontsource/manrope/files/manrope-{…}-800-normal.woff` with
  `createRequire(import.meta.url)`, reads them with `readFileSync` and converts them with
  `woffToSfnt`. The test checks that it returns 8 non-empty SFNT buffers and the same array on a
  second call.

- [ ] **4. `ProductLabelArt` fonts prop + `label-card.ts`.**
  - `ProductLabelArt`: add `fonts?: { sans: string; serif: string }` to the props. When it's set,
    the text groups use the `fontFamily` attribute with those names instead of
    `style={{ fontFamily: "var(--…)" }}`. The default output is unchanged. Extend the existing
    component test: with `fonts`, the `<text>` groups carry `font-family="Manrope"` /
    `"Playfair Display"`, and without it the markup is as before.
  - `label-card.ts` exports:
    - `CARD_WIDTH = 1200`, `CARD_HEIGHT = 630` and `CARD_VERSION = 1`;
    - `labelCardSvg(label: ProductLabel): string`. It builds
      `<svg xmlns width=1200 height=630 viewBox>`: a background `rect` in `labelPalette(family).bg`,
      then `<svg x=0 y=0 width=504 height=630>` holding
      `renderToStaticMarkup(<ProductLabelArt label fonts={OG_FONTS} />)`, then the right-hand text
      block (Q1). That block is built as strings with `layoutLabelText` for the name and the brand
      (`glyphWidth: 0.8`, as in `ProductLabelArt`), and every text value is XML-escaped (`&`, `<`,
      `>`, `"`). The brand is uppercased with `toLocaleUpperCase()`, like the card.
    - `renderLabelCardPng(label): Promise<Buffer>`. It runs
      `new Resvg(svg, { fitTo: { mode: "width", value: 1200 }, font: { fontBuffers: ogFontBuffers(),
      loadSystemFonts: false, defaultFontFamily: OG_FONTS.sans } }).render().asPng()`. resvg-js
      also has an async `renderAsync`; use it if the spike shows it works, so the event loop isn't
      blocked.
    - `labelCardEtag(publicId, updatedAt)`.
  - Tests:
    - the SVG contains the palette `bg` for a floral and a `null` family, the uppercased brand, the
      name's lines and escaped `&`/`<`;
    - the PNG starts with the PNG signature, and its IHDR width/height (bytes 16–23) read 1200×630
      for a Latin name ("Baccarat Rouge 540") and a Cyrillic one ("Жасминовий ранок");
    - the Cyrillic render differs from the same card with an empty title, so the glyphs aren't
      dropped.

- [ ] **5. `label-card-cache.ts`.** Provides `getOrRender(key, render)`. A `Map` of
  `Promise<Buffer>` holds at most `MAX_ENTRIES = 256`. On a hit it re-inserts the key (LRU); past
  the limit it evicts the oldest key; on rejection it deletes the entry. It also exports
  `clearLabelCardCache()` for tests. Tests: a second call doesn't call `render`; concurrent calls
  share one render; a rejected render is retried; eviction past the limit.

- [ ] **6. `updatedAt` on the handle result.** Add `updatedAt: products.updatedAt` to the columns
  `findProductByPublicId` / `findProductBySlug` select (`ProductDetailRow`). In `productResult`
  (`app/.server/services/products.ts`), return `updatedAt: row.updatedAt` on both the available
  and the archived branch, and add it to the `ProductHandleResult` type. Don't add it to
  `ProductDetail`: the client doesn't need it. Update `products.test.ts` fixtures/assertions, and
  any test that builds a `kind: "product"` result (`product.test.ts`), to include `updatedAt`.

- [ ] **7. Resource route `app/routes/og.products.$file.ts` + `app/routes.ts`.** Register
  `route("og/products/:file", "routes/og.products.$file.ts")` before the `*` catch-all, with a
  comment in the style of the sitemap/robots entries. The loader:
  1. strips `.png` from `params.file` and throws `data(null, { status: 404 })` (short cache
     header) without it or for an empty handle;
  2. calls `resolveProductHandle(handle, DEFAULT_LOCALE)`;
  3. on `null` or `available: false`, answers 404; on `kind: "redirect"`, answers
     `redirect("/og/products/<slug>.png", 301)`;
  4. computes `etag = labelCardEtag(product.id, updatedAt)`, and returns 304 if `If-None-Match`
     matches;
  5. otherwise renders
     `getOrRender(\`${product.id}:${updatedAt.getTime()}\`, () => renderLabelCardPng(label))` with
     `label = { id: product.id, brand, title, family: product.fragranceFamilies[0] ?? null }`, the
     same mapping as `product.tsx`, and returns `new Response(png, { headers })`.

  Tests mock `~/.server/services/products` and, where speed matters, `renderLabelCardPng`, like
  `robots.txt.test.ts`. Cases:
  - 200 with `image/png`, the exact `Cache-Control`, an `ETag`, and PNG bytes whose IHDR is
    1200×630 (one test with the real renderer);
  - 404 for an unknown handle, an archived product and `foo.jpg`;
  - 301 to the slug PNG for a redirect result;
  - 304 with an empty body for a matching `If-None-Match` (and for `W/"…"`, and a list);
  - a second request doesn't re-render (render spy called once).

- [ ] **8. `meta` uses the generated image.** Add
  `productShareImagePath(product: { id: string; slug: string | null }): string` to
  `app/lib/products.ts`, with a test for both the slug and the no-slug case. In
  `app/routes/product.tsx` `meta`, change the `image: product.image ? … : null` fallback to
  `{ url: productShareImagePath(product), alt: name, width: 1200, height: 630 }`; use
  `CARD_WIDTH/HEIGHT`-equivalent constants exported from `app/lib/products.ts`, because `meta`
  can't import `.server`. In `product.test.ts`:
  - without a photo, `og:image` is `https://<site>/og/products/<slug>.png`, `og:image:width` is
    `1200`, `og:image:height` is `630`, and `og:image:alt` is the name;
  - with a photo, it's still the photo's URL and size.

- [ ] **9. Docs.** In `docs/design.md` → "Label card palette", add one paragraph: products without
  a photo share `/og/products/<handle>.png`, a 1200×630 render of the card
  (`app/.server/og/label-card.ts`). Bump `CARD_VERSION` when the card's look changes.

- [ ] **10. Build and production check.** Run `pnpm build`, then `pnpm start` (with the DB up via
  Aspire or the existing `.env`). Check:
  - `curl -I http://localhost:3000/og/products/<slug>.png` returns 200, `image/png` and the
    headers;
  - `curl -H 'If-None-Match: <etag>'` returns 304;
  - an archived/unknown handle returns 404;
  - the PNG opens and looks right for a Cyrillic- and a Latin-named product.

  Confirm that `build/server/index.js` imports `@resvg/resvg-js` (external) rather than inlining
  it, and that the server starts without a native-binding error.

## Testing & verification
- Unit: `woff.test.ts`, `fonts.test.ts`, `label-card.test.ts` (real resvg render, IHDR check,
  Latin + Cyrillic), `label-card-cache.test.ts`, the `ProductLabelArt` fonts prop,
  `productShareImagePath`, `resolveProductHandle` `updatedAt`.
- Route: `og.products.$file.test.ts` (200/404/301/304, headers, cache hit), `product.test.ts`
  `meta` with and without a photo.
- `app/lib/client-bundle.guard.test.ts` still passes: nothing new in `app/lib/` imports zod or
  server code.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual:
  - step 10 against `pnpm start`;
  - view a photo-less product page's source and check `og:image` is absolute with width, height
    and alt;
  - after deploy (or through a tunnel), paste a product link into the Facebook Sharing Debugger
    (https://developers.facebook.com/tools/debug/) and a Telegram chat (via @WebpageBot to
    refresh) and check the card appears.

## Acceptance criteria
- [ ] `GET /og/products/<handle>.png` returns a 1200×630 PNG of the product's label card in its family palette, with its brand and name in Playfair Display and Manrope, for both Cyrillic and Latin names — steps 1–4, 7
- [ ] An unknown or archived handle returns 404, and responses are cacheable (`Cache-Control`, `ETag`, 304) — steps 5, 6, 7
- [ ] A product page without a photo has `og:image` pointing at its generated PNG (with width, height and alt), and a product with a photo still shares the photo — step 8
- [ ] A shared link to a product without a photo shows the card in the Telegram or Facebook Sharing Debugger preview — steps 7, 8, 10 (manual check after deploy)
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 10

## Out of scope
- Products with a photo: they keep sharing the photo. The route can render their card, but `meta`
  doesn't use it.
- Share images for other pages (catalog, blog, home), which keep `DEFAULT_SHARE_IMAGE`.
- Using the PNG in JSON-LD `Product.image` or in emails.
- Pre-rendering cards at build time, a persistent/disk cache, or a CDN.
- Any change to the on-site label card's look.
