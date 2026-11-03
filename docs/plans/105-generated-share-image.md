# Plan: Use the generated label card as the share image for products without a photo (#105)

Issue: https://github.com/savchukolgaa/jassmin/issues/105
Branch: `issue/105`
Worktree: `.claude/worktrees/issue-105`
Status: Planned

## Goal
When a customer shares a perfume that has no photo of its own in a messenger, the link preview
should show which perfume it is, not the generic `/og-default.jpg`. A language-neutral, cached
resource route renders a 1200×630 PNG for each product. The left side is a real photo of the
shop's JASSMIN bottle, the same photo for every perfume. The right side shows the perfume's brand
and name in its fragrance-family palette (#99). The product page's `meta` uses this route as
`og:image` whenever `product.image` is `null`.

## Dependencies & prerequisites
- #99 (label card): done on `origin/main`. `app/lib/label-art.ts` (`labelPalette`,
  `layoutLabelText`) provides the colours and text fitting.
- #85 (share metadata): done. `seoMeta` / `buildSeoMeta` in `app/lib/seo.ts` already make
  `image.url` absolute and emit `og:image:width/height/alt`.
- #83 (slugs, `resolveProductHandle`) and #88 (archived products): done.
- **Shop photo**: `images/IMG_1589.JPG` from the main checkout (untracked). It's a single JASSMIN
  bottle on a hand against a plain light wall, 2988×4032. Step 1 crops and resizes it to a small
  JPEG with its metadata stripped and commits it. The original is never committed.
- **New packages** (`pnpm add`):
  - `@resvg/resvg-js`: SVG → PNG, a napi-rs native addon with prebuilt per-platform binaries in
    `optionalDependencies` and no install script, so `allowBuilds` doesn't need a change. The spike
    in step 1 checks this.
  - `@fontsource/playfair-display` and `@fontsource/manrope`: the static (non-variable) builds of
    the same fonts, for their WOFF files at the exact weights (see "Decisions" and Q1). They're
    imported only under `app/.server/`, never into the client bundle.
- No env vars, no migrations.

## Decisions & assumptions
- **The share image is a real photo plus the perfume's name** (user's decision). Every perfume is
  sold in the same clear JASSMIN bottle, so one shop photo serves all products and nobody uploads
  anything per product. The name, drawn next to the photo, tells perfumes apart. The site itself
  doesn't change: catalog and product pages keep #99's drawn label cards. A product with its own
  uploaded photo still shares that photo.
- **The photo is committed to the repo, not uploaded to Strapi** (user's decision), as
  `app/.server/og/share-bottle.jpg`. Changing it later is a code change and a `CARD_VERSION` bump.
- **Preparing the photo (one-off, in step 1)**: crop `IMG_1589.JPG` to 4:5 around the bottle and
  hand. Resize it to **504×630**, the left strip of the 1200×630 image at 1:1, and encode it as
  JPEG at quality ~82, aiming for ≤ 80 KB. **Strip all EXIF metadata**: an iPhone photo can carry
  GPS coordinates, and the image is public. Use a throwaway tool (`pnpm dlx sharp-cli` or
  ImageMagick), never a project dependency. sharp drops metadata by default.
- **Layout (1200×630)**:
  - Left, x 0–504: the photo, full height.
  - Right, x 504–1200: a `rect` in `labelPalette(family).bg` holding the following, left-aligned
    at x ≈ 568 with about 64 px padding:
    - the brand in Manrope 800 capitals with letter-spacing, in `palette.mark`, fitted with
      `layoutLabelText` (`glyphWidth: 0.8`, as in `ProductLabelArt`, sizes `[34, 30, 26]`,
      `maxLines: 2`);
    - a short rule;
    - the name in Playfair Display 700, `layoutLabelText` width ≈ 568, `maxLines: 3`, sizes
      `[76, 64, 54, 46]`, in `palette.mark`;
    - "jassmin." in Playfair 700 at the bottom right.
  - The text block is centred vertically from the computed line heights.
  - A thin strip of `palette.accent` (8 px) between photo and panel ties the photo to the
    product's family colour.
  - `palette.mark` is the colour the palette gives for text on `bg`, so its contrast is already
    checked (`contrastRatio`, #99 tests).
  - "jassmin." is the brand mark, not translatable copy, so it needs no i18n key.
- **Rasteriser: `@resvg/resvg-js`.** The renderer builds a plain SVG string with `<image>` for
  the photo and `<text>` for the words, and passes fonts in with `font.fontBuffers` and
  `loadSystemFonts: false`. resvg decodes embedded JPEG data URIs itself, so we don't need sharp.
  Satori isn't needed: the layout is a few absolutely positioned lines.
- **Embedding the photo**: `import shareBottle from "./share-bottle.jpg?inline"`. Vite inlines
  it as a base64 `data:image/jpeg` URL into the server bundle, so there's no runtime file path to
  break in `build/`. `vite/client` types are already in `tsconfig.json`. If Vitest doesn't inline
  it (the spike checks this; `root.test.ts` notes `?url` resolving to `""` for CSS), the fallback
  is `readFileSync(new URL("./share-bottle.jpg", import.meta.url))`, with the file copied next to
  the server build.
- **Static fonts instead of `@fontsource-variable/*`** **(unconfirmed, see Q1)**. The variable
  packages ship only WOFF2 variable fonts. resvg/fontdb reads only TTF/OTF, and WOFF2 needs a
  glyph-table reconstruction (`wawoff2` or similar). Variable fonts also aren't reliably instanced
  at weight 700/800. The static `@fontsource/*` packages ship WOFF1 files per weight and subset.
  WOFF1 → SFNT takes about 40 lines with `node:zlib`, in `app/.server/og/woff.ts`. We load the
  `latin`, `latin-ext`, `cyrillic` and `cyrillic-ext` subsets of Playfair Display 700 and Manrope
  800. The typefaces are the same as on the site.
- **Route path: `og/products/:file`, with the loader requiring a `.png` suffix.** React Router
  dynamic segments can't be partial. The public URL is still `/og/products/<handle>.png`.
- **Handle resolution: `resolveProductHandle(handle, DEFAULT_LOCALE)`**. The image has no
  translated copy.
  - `null` → 404.
  - `available: false` (archived) → 404.
  - `kind: "redirect"` → 301 to `/og/products/<current slug>.png`.
  - A product *with* its own photo still gets an image from this route. Only `meta` decides when
    to use it.
- **`updatedAt` for the ETag.** `ProductDetail` doesn't carry `updated_at`, so we add
  `updatedAt: Date` to the server-only `kind: "product"` result of `resolveProductHandle`, next to
  `id`. Its select in `app/.server/db/queries/products.ts` gains `updatedAt: products.updatedAt`.
  CMS edits refresh it through `updatedAt()`'s `$onUpdate`.
- **ETag** = `"<publicId>-<updatedAt ms base36>-v<CARD_VERSION>"`, a strong ETag. Bump
  `CARD_VERSION` when the photo or layout changes. `If-None-Match` is parsed as a comma list (`*`,
  `W/` prefixes allowed). A match returns 304 with the same `ETag` and `Cache-Control` and no
  body.
- **In-memory cache**: a small LRU `Map` of render promises in
  `app/.server/og/label-card-cache.ts`, keyed on `publicId:updatedAt`, holding at most 256
  entries. ~140 products at roughly 60–120 KB per PNG is about 15 MB at most. Concurrent crawler
  hits share one render, and a rejected render is dropped. The ETag/304 check runs before any
  render.
- **Response headers**: `Content-Type: image/png`,
  `Cache-Control: public, max-age=86400, stale-while-revalidate=604800`, `ETag`. A 404 sends
  `Cache-Control: public, max-age=300`.
- `robots.txt` (`app/.server/seo/robots.ts`) doesn't disallow `/og/`. No change needed.
- `meta` builds the URL with a new isomorphic helper `productShareImagePath(product)` in
  `app/lib/products.ts`. It returns `/og/products/${product.slug ?? product.id}.png`, the same
  handle as `productHref`, and exports `SHARE_IMAGE_SIZE = { width: 1200, height: 630 }`, because
  `meta` can't import `.server`.

- **Implementation findings (step 1 spike)**:
  - resvg-js 2.6.2 mis-renders fonts passed as `fontBuffers`: it used a squeezed wrong face for
    Manrope and a fallback for Playfair. As `fontFiles` they render correctly, so `fonts.ts`
    writes the converted `.ttf` files once to `os.tmpdir()/jassmin-og-fonts/<content hash>.ttf`
    and passes their paths. `ogFontFiles()` replaces the planned `ogFontBuffers()`.
  - Manrope's static 800 files name their family **"Manrope ExtraBold"**, not "Manrope", so
    `OG_FONTS.sans` is that name.
  - `@fontsource/playfair-display` has no `cyrillic-ext` file at 700, so there are 7 font files:
    Playfair latin, latin-ext and cyrillic, and Manrope latin, latin-ext, cyrillic and
    cyrillic-ext.
  - The photo was cropped with Pillow (`ImageOps.exif_transpose`, crop 1700×2125 at (650, 1150),
    Lanczos to 504×630, JPEG q82, saved without EXIF). The result is 61 KB and has no EXIF data.
  - `?inline` gives a `data:image/jpeg;base64,` URL under Vitest too, so no fallback was needed.
  - A render takes ≈ 270 ms. It runs through `renderAsync`, on libuv's thread pool.
  - `SHARE_IMAGE_SIZE` and `productShareImagePath` (step 8) were added to `app/lib/products.ts`
    early, because `label-card.ts` uses the size.

## Open questions
- [x] **Q1: Is it OK to add the static `@fontsource/playfair-display` and `@fontsource/manrope`
  packages (server-only) next to the variable ones?** Why it matters: the issue says to load the
  `@fontsource-variable` files. Those are WOFF2 variable fonts, which resvg can't load or render
  at weight 700/800 without an extra WOFF2 decoder and variable-font instancing. Recommended
  default: add the static packages. The fallback is `wawoff2` for WOFF2 decoding, with the spike
  checking the weights. Affects steps: 1, 3. **Answer:** went with the default; the user didn't object after planning.

## Resolved questions
- **The drawn card, or real photos?** One general shop photo of the JASSMIN bottle for every
  perfume, with the perfume's brand and name beside it, in the share preview only. The site keeps
  the drawn cards (source: user, in planning).
- **Upload the photo in Strapi, or commit it?** Commit it to the repo (source: user, in planning).
- **Which photo?** `IMG_1589.JPG`: one bottle, centred, on a plain neutral wall. It crops cleanly
  to 4:5 and suits every family colour. `IMG_1585` (three bottles) is busy at thumbnail size, and
  `IMG_1602` (daisies) is square and floral-specific.
- **Which library?** `@resvg/resvg-js`. The issue names satori + resvg only as an option, and a
  simple SVG of an image and text lines doesn't need satori's flexbox layout (source: #105
  Context).
- **Can the route be `:handle.png`?** No. React Router segments are whole, so the route is
  `og/products/:file` and the loader checks the suffix.
- **Where does `updated_at` come from?** From `products.updated_at`, refreshed on every update
  (source: `app/.server/db/schema.ts`, `schema.test.ts`). It's added to the server-only handle
  result.
- **Archived products?** `resolveProductHandle` returns them with `available: false` (#88), and
  the route turns that into a 404 (source: `app/.server/services/products.ts`, #105 Technical).
- **Does the production runtime support a native addon?** Yes. `pnpm start` is
  `react-router-serve` on Node with `node_modules` present, and `@node-rs/argon2` (also napi-rs)
  already works in it (source: `package.json`, `app/.server/password.ts`). Steps 1 and 10 verify
  this.
- **Does the route need the shop layout, session or consent?** No. It's a top-level resource
  route, like `sitemap.xml` and `robots.txt` (source: `app/routes.ts`).
- **Is there new user-facing copy?** No, so there are no i18n keys.

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `package.json`, `pnpm-lock.yaml` | add `@resvg/resvg-js`, `@fontsource/playfair-display`, `@fontsource/manrope` |
| create | `app/.server/og/share-bottle.jpg` | the cropped 504×630 shop photo, metadata stripped |
| create | `app/.server/og/woff.ts` (+ `.test.ts`) | WOFF1 → TTF/OTF (SFNT) conversion with `node:zlib` |
| create | `app/.server/og/fonts.ts` (+ `.test.ts`) | resolve, convert and memoise the font buffers; export the family names |
| create | `app/.server/og/label-card.ts` (+ `.test.ts`) | `shareCardSvg(label)` (1200×630 SVG string), `renderShareCardPng(label)` (resvg), `CARD_VERSION`, `shareCardEtag` |
| create | `app/.server/og/label-card-cache.ts` (+ `.test.ts`) | small LRU of render promises |
| modify | `app/.server/db/queries/products.ts` | select `updatedAt` in the detail row |
| modify | `app/.server/services/products.ts` (+ test) | `updatedAt` on the `kind: "product"` result |
| create | `app/routes/og.products.$file.ts` (+ `.test.ts`) | the resource route loader |
| modify | `app/routes.ts` | `route("og/products/:file", "routes/og.products.$file.ts")` |
| modify | `app/lib/products.ts` (+ test) | `productShareImagePath(product)`, `SHARE_IMAGE_SIZE` |
| modify | `app/routes/product.tsx`, `app/routes/product.test.ts` | `meta` image fallback to the generated PNG |
| modify | `docs/design.md` | a paragraph under "Label card palette" about the share image |

## Steps

- [x] **1. Spike: prepare the photo, add the dependencies, prove the pipeline.**
  - Copy `images/IMG_1589.JPG` from the main checkout into the scratchpad. Crop it to 4:5 around
    the bottle and hand, resize it to 504×630 and save it as JPEG q≈82 with metadata stripped:
    `pnpm dlx sharp-cli -i IMG_1589.JPG -o share-bottle.jpg resize 504 630 --fit cover --position centre`,
    or ImageMagick. Check that the bottle is fully in frame, that it's ≤ 80 KB, and that
    `exiftool` (or reading the bytes) shows no GPS/EXIF. Move it to
    `app/.server/og/share-bottle.jpg`.
  - `pnpm add @resvg/resvg-js @fontsource/playfair-display @fontsource/manrope`.
  - In a throwaway scratchpad script, convert one WOFF to SFNT. Render
    `<svg><image href="data:image/jpeg;base64,…"/><text font-family="Playfair Display" font-weight="700">Жасмин Jasmine</text></svg>`
    with `new Resvg(svg, { font: { fontBuffers, loadSystemFonts: false, defaultFontFamily: "Manrope" } })`.
    Confirm four things: the JPEG draws; Cyrillic and Latin glyphs both render when each subset is
    a separate buffer (fontdb falls back per character across faces); 700/800 come out bold; and
    the `files/*.woff` paths resolve via `createRequire` (check the package's `exports`).
  - Check that `?inline` gives a `data:image/jpeg;base64,` string under Vitest. If not, take the
    `readFileSync` fallback from "Decisions".
  - Check that `pnpm install` printed no "ignored build scripts" warning for resvg.

- [x] **2. `woff.ts`: WOFF1 → SFNT.** `export function woffToSfnt(woff: Buffer): Buffer`. It does
  the following:
  - check the `wOFF` signature;
  - read `flavor`, `numTables` and the 20-byte table directory entries;
  - `inflateSync` each table where `compLength < origLength`;
  - write the SFNT header (`searchRange`, `entrySelector`, `rangeShift`), 16-byte table records
    with 4-byte-aligned offsets, then the padded tables.

  It throws on a bad signature. Tests: a real `@fontsource/manrope` WOFF converts to a buffer
  starting with `0x00010000`, with `numTables` matching and each table inside the buffer; a
  non-WOFF buffer throws.

- [x] **3. `fonts.ts`: load the fonts once.** `export const OG_FONTS = { sans: "Manrope", serif:
  "Playfair Display" }` and `export function ogFontBuffers(): Buffer[]`, memoised. It resolves
  `@fontsource/playfair-display/files/playfair-display-{latin,latin-ext,cyrillic,cyrillic-ext}-700-normal.woff`
  and `@fontsource/manrope/files/manrope-{…}-800-normal.woff` with
  `createRequire(import.meta.url)`, then reads and converts them. The test checks that it returns
  8 SFNT buffers and the same array on a second call.

- [x] **4. `label-card.ts`: the share image.**
  - Exports: `CARD_WIDTH = 1200`, `CARD_HEIGHT = 630`, `PHOTO_WIDTH = 504`, `CARD_VERSION = 1`.
  - `shareCardSvg(label: ProductLabel): string` builds
    `<svg xmlns width=1200 height=630 viewBox>` containing:
    - `<image href={shareBottle} x=0 y=0 width=504 height=630 preserveAspectRatio="xMidYMid slice"/>`;
    - the accent strip;
    - the `bg` panel;
    - the brand, rule, name and wordmark `<text>` elements as described in "Decisions", with
      `font-family` set to `OG_FONTS` names.

    Every text value is XML-escaped (`&`, `<`, `>`, `"`). The brand is uppercased with
    `toLocaleUpperCase()`, like the card.
  - `renderShareCardPng(label): Promise<Buffer>` uses
    `new Resvg(svg, { fitTo: { mode: "original" }, font: { fontBuffers: ogFontBuffers(), loadSystemFonts: false, defaultFontFamily: OG_FONTS.sans } })`
    and returns `.render().asPng()`. Use `renderAsync` if the spike shows it works, so the event
    loop isn't blocked.
  - `shareCardEtag(publicId, updatedAt)`.
  - Tests:
    - the SVG contains the photo data URI, the palette `bg`/`accent` for a floral and a `null`
      family, the uppercased brand, the name's lines and escaped `&`/`<`;
    - the PNG starts with the PNG signature, and its IHDR width/height (bytes 16–23) read 1200×630
      for a Latin name ("Baccarat Rouge 540") and a Cyrillic one ("Жасминовий ранок");
    - the Cyrillic render differs from the same card with an empty title, so the glyphs aren't
      dropped.

- [x] **5. `label-card-cache.ts`.** Provides `getOrRender(key, render)`. A `Map` of
  `Promise<Buffer>` holds at most `MAX_ENTRIES = 256`. A hit re-inserts the key (LRU); past the
  limit it evicts the oldest key; on rejection it deletes the entry. It also exports
  `clearShareCardCache()` for tests. Tests: a second call doesn't render; concurrent calls share
  one render; a rejected render is retried; eviction works.

- [x] **6. `updatedAt` on the handle result.** Add `updatedAt: products.updatedAt` to the columns
  `findProductByPublicId` / `findProductBySlug` select (`ProductDetailRow`). Return
  `updatedAt: row.updatedAt` from `productResult` on both branches, and add it to
  `ProductHandleResult`, not to `ProductDetail`. Update the fixtures in `products.test.ts` and
  `product.test.ts`.

- [x] **7. Resource route `app/routes/og.products.$file.ts` + `app/routes.ts`.** Register
  `route("og/products/:file", "routes/og.products.$file.ts")` before the `*` catch-all, with a
  comment in the style of the sitemap/robots entries. The loader:
  1. strips `.png` from `params.file` and answers 404 (short cache header) without it or for an
     empty handle;
  2. calls `resolveProductHandle(handle, DEFAULT_LOCALE)`;
  3. on `null` or `available: false`, answers 404; on `kind: "redirect"`, answers 301 to
     `/og/products/<slug>.png`;
  4. computes `etag = shareCardEtag(product.id, updatedAt)`, and returns 304 if `If-None-Match`
     matches;
  5. otherwise calls
     `getOrRender(\`${product.id}:${updatedAt.getTime()}\`, () => renderShareCardPng(label))` with
     `label = { id: product.id, brand, title, family: product.fragranceFamilies[0] ?? null }` and
     returns `new Response(png, { headers })`.

  Tests mock `~/.server/services/products` and, where speed matters, the renderer, like
  `robots.txt.test.ts`. Cases:
  - 200 with `image/png`, the exact `Cache-Control`, an `ETag`, and PNG bytes with an IHDR of
    1200×630 (one test with the real renderer);
  - 404 for an unknown handle, an archived product and `foo.jpg`;
  - 301 to the slug PNG for a redirect;
  - 304 with an empty body for a matching `If-None-Match` (plain, `W/"…"`, and a list);
  - a second request doesn't re-render.

- [x] **8. `meta` uses the generated image.** Add `productShareImagePath` and `SHARE_IMAGE_SIZE`
  to `app/lib/products.ts`, with tests for the slug and no-slug cases. In `app/routes/product.tsx`
  `meta`, change the `product.image ? … : null` fallback to
  `{ url: productShareImagePath(product), alt: name, ...SHARE_IMAGE_SIZE }`. In
  `product.test.ts`:
  - without a photo, `og:image` is `https://<site>/og/products/<slug>.png` with width `1200`,
    height `630` and the name as alt;
  - with a photo, it's still the photo's URL and size.

- [x] **9. Docs.** In `docs/design.md` → "Label card palette", add a paragraph: a product without
  its own photo shares `/og/products/<handle>.png`, the shop bottle photo
  (`app/.server/og/share-bottle.jpg`) with the brand and name in the family palette
  (`app/.server/og/label-card.ts`). Bump `CARD_VERSION` when the photo or layout changes.

- [ ] **10. Build and production check.** Run `pnpm build`, then `pnpm start` with the DB up.
  Check:
  - `curl -I http://localhost:3000/og/products/<slug>.png` returns 200, `image/png` and the
    headers;
  - `If-None-Match: <etag>` returns 304;
  - an archived/unknown handle returns 404;
  - the PNG looks right for a Cyrillic- and a Latin-named product, a light family (floral) and a
    dark one (oriental/woody).

  Confirm that `build/server/index.js` keeps `@resvg/resvg-js` external, that the photo is inlined
  (or copied, if we took the fallback), and that the server starts without a native-binding error.

## Testing & verification
- Unit: `woff.test.ts`, `fonts.test.ts`, `label-card.test.ts` (real resvg render, IHDR check,
  Latin + Cyrillic), `label-card-cache.test.ts`, `productShareImagePath`,
  `resolveProductHandle` `updatedAt`.
- Route: `og.products.$file.test.ts` (200/404/301/304, headers, cache hit), `product.test.ts`
  `meta` with and without a photo.
- `app/lib/client-bundle.guard.test.ts` still passes: nothing new in `app/lib/` imports zod or
  server code, and the photo lives under `app/.server/`.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual:
  - step 10 against `pnpm start`;
  - view a photo-less product page's source and check `og:image` is absolute with width, height
    and alt;
  - after deploy (or through a tunnel), check the preview in the Facebook Sharing Debugger
    (https://developers.facebook.com/tools/debug/) and in Telegram (refresh via @WebpageBot).

## Acceptance criteria
- [ ] `GET /og/products/<handle>.png` returns a 1200×630 PNG of the product's label card in its family palette, with its brand and name in Playfair Display and Manrope, for both Cyrillic and Latin names — steps 1–4, 7. (Per the user's decision, the "card" is the shop bottle photo plus the brand and name on the family-palette panel.)
- [ ] An unknown or archived handle returns 404, and responses are cacheable (`Cache-Control`, `ETag`, 304) — steps 5, 6, 7
- [ ] A product page without a photo has `og:image` pointing at its generated PNG (with width, height and alt), and a product with a photo still shares the photo — step 8
- [ ] A shared link to a product without a photo shows the card in the Telegram or Facebook Sharing Debugger preview — steps 7, 8, 10 (manual check after deploy)
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 10

## Out of scope
- Showing the shop photo on the site (catalog, product page). The drawn label cards (#99) stay.
- Uploading the photo through Strapi or making it editable by staff.
- Products with their own photo: they keep sharing it.
- Share images for other pages (catalog, blog, home), which keep `DEFAULT_SHARE_IMAGE`.
- Using the PNG in JSON-LD `Product.image` or in emails.
- Pre-rendering at build time, a persistent/disk cache, or a CDN.
