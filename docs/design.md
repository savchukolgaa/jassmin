# Jassmin design: Option C+ (Bold blush, upgraded)

The storefront follows **Option C+**, chosen on 2026-10-23 in #27.

- **Design canvas:** https://claude.ai/artifact/RCvne95y2han2bw8dWm1iW (private; ask the owner for
  access). Use the row titled **"Chosen direction: Option C+"**. Options A–G stay on the canvas only
  for reference and must not be implemented. Until the owner updates it, the canvas still shows the
  old deep-pink header: follow the white header described below (#72). The C+ artboards also still
  show headings in Manrope; follow the serif headings below (#73), drawn on the `Serif headings
  (#73)` artboards.
- **Shared foundation** (#27): theme tokens in `app/app.css`, `Button` / `ButtonLink` in
  `app/components/ui/`, and `Header` / `Footer` in `app/components/layout/`. Page issues reuse
  these instead of adding new colours, fonts or button styles.
- **Contrast tests:** `app/theme.test.ts` checks the token pairs below, so a token change that
  breaks WCAG AA fails `pnpm test`.

## Pages and issues

| Canvas page | Route | Issue |
|---|---|---|
| `Option C+ — Bold blush, upgraded (chosen)` | `/` | #7 |
| `C+ Catalog` | `/catalog/:gender` | #8 |
| `C+ Product` | `/products/:id` | #8, #26 |
| `C+ Sign in / Sign up` | `/login`, `/register` | #9 |
| `C+ Account` | `/account` | #12 |
| `C+ Account profile`, `C+ Account profile, phone width (errors)` | `/account/profile` | #54 |
| `C+ Offers`, `C+ Offers, phone width` | `/offers` | #55 |
| `C+ Popular`, `C+ Popular, phone width` | `/popular` | #67 |
| `Serif headings (#73) — home`, `Serif headings (#73) — product` | `/`, `/products/:id` (heading font only) | #73 |

Cart and checkout aren't designed yet. Build them from the tokens and components below. There is
no Unisex catalog page: catalogs are `/catalog/women` and `/catalog/men` only.

`/offers` (#55) opens with a deep-pink hero: the page title as a small uppercase `h1`, the main
campaign's title, text, a white price-note pill, "valid until" and a `dark` CTA, beside an arched
image. Without a campaign the band holds only the title and intro. A blush strip of white perk cards
follows, then one section per offer kind: white `rounded-card-lg` offer cards with a `line` border,
a blush price-note pill, a `primary` `sm` CTA and the linked products as regular product cards. The
empty state is the blush panel used by the account's "No orders yet". The `noCampaign` tweak on the
artboard shows it.

`/popular` (#67) is reached from the header's "Bestsellers" item (between Catalog and Offers,
marked current; with five links the inline nav shows from `lg`, the hamburger menu below it), the home hero's "Order Now" and the trio builder's "Show my trio". It opens with
a deep-pink band: a small uppercase "Bestsellers" eyebrow, the page title as the `h1` and an
intro. When the trio builder sent families, they follow as white removable chips (`primary-dark`
text, a "×", each a link without that family) and a white "Show all popular" link. Below, a muted
count and a grid of the home page's compact bestseller cards (`card-tilt`, the round `quick-add`
+ button and the "Added to cart" toast), 12 per page with the catalog's pagination. A blush
`rounded-card-lg` panel "Looking for something else?" links to both catalogs. With no matches the
grid and that panel give way to the blush empty panel used by `/offers`, with "Show all popular"
(`primary`) and the two catalogs (`dark`). The `filtered` and `noMatches` tweaks on the
artboard show both states.

Like cart and checkout, the cookie banner and the privacy policy page (#18) aren't on the canvas. The banner
(`features/consent/CookieBanner.tsx`) is a white `rounded-card` panel with a `line` border fixed to
the bottom of every public page, with equally prominent `primary` "Accept" and `dark` "Decline"
buttons (size `sm`): don't make declining harder to find than accepting. `/privacy` is a text page in
the blog article's column (`max-w-3xl`).

## Colour tokens

Each `--color-<name>` token in `@theme` becomes a Tailwind colour (`bg-<name>`, `text-<name>`,
`border-<name>`, …). Ratios use the WCAG 2.x formula.

| Token | Hex | Use | Contrast |
|---|---|---|---|
| `primary` | `#C22F4B` | Deep pink: footer, primary buttons, hero bands, the header's cart pill | white text on it **5.52:1**; as text on white 5.52:1, on `blush` 5.13:1 |
| `primary-dark` | `#A8233D` | Primary hover; **pink text on light backgrounds** | white on it 7.06:1; on white 7.06:1, on `blush` 6.56:1 |
| `primary-light` | `#FF8FA1` | Soft-pink accent, **only on `ink` or `primary` surfaces** | as text on `ink` 7.93:1; on `primary` 2.55:1, so decorative only |
| `brand-legacy` | `#FF5C77` | The original brand pink, kept for reference | white on it 2.98:1, so **never behind text** |
| `ink` | `#1F1A1C` | Headings, body text on light, the `dark` button, dark surfaces | on white 17.17:1, on `card` 15.60:1 |
| `body` | `#4A4245` | Long-form body copy | on white 9.74:1 |
| `muted` | `#5F5558` | Secondary text, captions, labels | on white 7.17:1, on `blush` 6.67:1 |
| `on-dark-muted` | `#D9CFD2` | Secondary text on `ink` | on `ink` 11.29:1 |
| `blush` | `#FFF4F5` | Light pink page sections, hover background in white panels | (background) |
| `card` | `#F7F3F4` | Card and input backgrounds | (background) |
| `line` | `#E5DADD` | Borders and dividers (decorative, 1.36:1 on white) | (not for text or required UI boundaries) |
| `success` | `#1D6B48` | Success text, e.g. "Added to cart" | on `success-bg` 5.73:1 |
| `success-bg` | `#E8F4EE` | Success message background | (background) |

### Colour rules

- White text goes on `primary`, `primary-dark` or `ink`. On `primary` it passes AA for all text
  sizes.
- Pink text on a light background uses `text-primary-dark` (or `text-primary` for small UI such as
  the cart count). Never use `primary-light` or `brand-legacy` as text on light.
- `primary-light` is only an accent on dark or deep-pink surfaces: decorative wordmarks (such as
  the footer's) and text on `ink`. The header's wordmark dot sits on white, so it's `primary`.
- The storefront is light-only: C+ has no dark theme. `app/app.css` forces `color-scheme: light` on
  `html` and `app/root.tsx` sets `<meta name="color-scheme" content="light">`, so pages, native form
  controls and scrollbars stay light when the OS or browser uses dark mode. Don't add `dark:`
  variants (`app/theme.test.ts` fails if one appears); a dark theme would need its own design issue.
- **The header is white** (#72), on every page, so it stands apart from the deep-pink hero bands:
  `bg-white` with a `line` bottom border, `ink` wordmark and links, `primary-dark` for the current
  section (underlined in the bar) and on hover over `blush`, a `primary` cart pill and logged-in
  profile circle with white text, and the language switcher's active flag on `blush`. Its catalog
  dropdown and mobile menu are white panels in the same style. It uses tokens only, so a palette
  change in `app/app.css` recolours it. **The footer stays deep pink.**

## Typeface and scale

Two families from Google Fonts, loaded in one request in `app/root.tsx` `links` with
`display=swap`; Google serves the Cyrillic and Latin subsets as separate files automatically.

- **Playfair Display** 600–700 (`--font-serif: "Playfair Display", Georgia, serif`, #73) for
  headings, the wordmark, prices and the big step numbers. A base rule in `app/app.css` sets every
  `h1`–`h3` in it, so a new heading gets the serif without a class; use `font-serif` on anything
  else in that list. Small uppercase labels that happen to be headings (the `/offers` eyebrow
  `h1`) add `font-sans` to stay Manrope.
- **Manrope** 400–800 (`--font-sans`, followed by the system stack) for everything else: body
  text, buttons, nav, forms, labels, chips and badges.
- **Headings:** `font-bold` (700) with `tracking-[-0.01em]`, and `leading-tight` or `leading-none`
  on large sizes. Don't use `font-extrabold` or the old tight tracking (`-0.03em` to `-0.05em`) on
  serif text: Playfair is already high-contrast and its weights stop at 900.
- **Prices in the serif:** the product page and product card prices, the cart line total, the
  cart/checkout total, account order prices, the hero badge and the payment simulator amount.
  Prices inside a sentence (CTA labels, the marquee, "each …", the free-delivery hint, the
  "date · items · price" order line) and the subtotal/discount rows stay Manrope.
- **Suggested scale:**

  | Role | Mobile → desktop |
  |---|---|
  | Hero heading | `text-5xl` → `md:text-7xl` |
  | Page heading | `text-4xl` → `md:text-5xl` |
  | Section heading | `text-3xl` → `md:text-4xl` |
  | Card heading | `text-xl` |
  | Body | `text-base`, weight 400–500, `text-body` or `text-ink` |
  | Labels, nav | `text-sm`, weight 700 |

- **Wordmark:** "jassmin." in lower case, `font-serif font-bold tracking-[-0.01em]`. In the white header it's
  `ink` with a `primary` dot; on dark or deep-pink surfaces the dot is `primary-light`. The dot is
  marked `aria-hidden`.

## Shape and spacing

- **Pills:** buttons, chips, nav items and the cart use `rounded-pill` (`--radius-pill: 999px`).
- **Cards:** `rounded-card` (24px) and `rounded-card-lg` (32px) for large panels. Dropdown panels
  use `rounded-card`.
- **Arch images:** the top radius is half the width. Use `rounded-t-full` on a portrait image; the
  browser clamps the radius to half the width, which gives an arch.
- **Layout:** `container mx-auto px-4`, a 16px side gutter. Nothing may scroll horizontally at
  375px. Clip decorative overflow with `overflow-hidden` on the parent.
- **Touch targets** are at least 44 × 44px (`min-h-11`, `size-11`).

## Focus rings

Every interactive element gets a 3px `focus-visible` outline with a 2px offset, coloured so it
keeps at least 3:1 against its surface:

| Surface | Ring | Contrast |
|---|---|---|
| Deep pink (`primary`: footer, hero bands) | white | 5.52:1 |
| Dark (`ink`) | `primary-light` | 7.93:1 |
| White, `blush` or `card` (header, its dropdown and mobile menu, page content, form fields) | `primary` | 5.52:1 on white, 5.13:1 on `blush` |

`primary-light` isn't used on deep pink (2.55:1) or on white (2.3:1); `app/theme.test.ts` fails if
`outline-primary-light` appears outside the two `ink` sections. In layout code, use
`focusRing("onPrimary" | "onLight")` from `app/components/layout/nav.ts`; the white header and its
panels use `"onLight"`, the footer `"onPrimary"`.

**Hover on deep pink:** darken to `primary-dark` (white text stays at 7.06:1) or invert to white.
Don't use a translucent white overlay such as `bg-white/15`: white text on it drops to about 4.35:1.

## Buttons

`Button` (a `<button>`) and `ButtonLink` (a React Router `<Link>`) share `buttonClasses()`:

| Variant | Look | Use on |
|---|---|---|
| `primary` (default) | `bg-primary`, white text, brand shadow; hover `primary-dark` | white or blush |
| `dark` | `bg-ink`, white text | light or pink-tinted sections, e.g. "Order Now" |
| `outline-light` | 2px white border, white text; hover turns white with `primary` text | deep pink (hero bands, footer) |
| `ghost` | `primary-dark` text, no background | white |

| Size | Minimum height |
|---|---|
| `sm` | 44px |
| `md` (default) | 52px |
| `lg` | 58px |

All variants are pills with weight 800 and scale to 1.03 on hover when motion is allowed.

```tsx
<ButtonLink to="/catalog/women" size="lg">Shop women</ButtonLink>
<Button variant="dark" type="submit" loading={navigation.state === "submitting"}>
  Order Now
</Button>
<ButtonLink to="/#about" variant="outline-light">About us</ButtonLink>
```

## Motion

The utilities are in `app/app.css`. Use motion to support content, never to hide it.

| Utility | Effect | Typical use |
|---|---|---|
| `animate-fade-up` + `anim-delay-1` … `anim-delay-6` | fade in from 16px below, each delay step +80ms | hero text, staggered sections and cards |
| `animate-pop` | fade in from 90% scale | chips, badges, small confirmations |
| `animate-spin-in` | rotate and scale in | the price badge |
| `animate-marquee` + `marquee-pause` | scroll −50% in a loop over 26s; pauses on hover | the home offers band: a slim `ink` strip (`py-2`, `text-base`/`md:text-lg`) with the tester trio and free delivery only, no fragrance families (#72); render the content twice in the track, repeating the offers so a half is wider than the screen, and keep it `aria-hidden` |
| `animate-toast` | slide up and fade in | the "Added to cart" popup (use `role="status"`) |
| `lift` | rise 4px with a shadow on hover | product and blog cards |
| `animate-rise` | fade in from 80px below over 1s, after 0.2s | the hero's arched image |
| `animate-badge` | spin in from −200° and zero size at 0.7s, then wobble −8°↔6° every 4s (give it `-rotate-8`) | the hero's round price badge |
| `animate-float` | drift up 14px and back every 6s | the hero's floating chip |
| `animate-slot-pop` | grow from 30% with a twist, overshoot, settle | a filled "Build your trio" slot |
| `card-tilt` | rise 6px and tilt −1° on hover; its `[data-zoom]` image scales to 1.04 | compact product cards (home bestsellers) |
| `tile-arrow` | rise 6px on hover and slide its `[data-arrow]` 10px right | category tiles |
| `quick-add` | turn 90° and scale to 1.08 on hover | the round + add-to-cart button |
| `chip-hover` | lift 2px on hover | filter chips (trio builder) |
| `step-hover` | lift 4px on hover | "How it works" step cards |
| `reveal` | fade up as it scrolls into view (`animation-timeline: view()`) | sections below the fold |

Rules:

- **Reduced motion:** one `@media (prefers-reduced-motion: reduce)` block at the end of
  `app/app.css` turns off every animation and transition. Keyframes only define their start state,
  so with motion off everything shows in its final, visible state. The button hover scale is also
  `motion-safe:`.
- The hover utilities above only move inside `@media (prefers-reduced-motion: no-preference)`,
  so with reduced motion nothing shifts on hover.
- `reveal` only applies inside `@supports (animation-timeline: view())`. Other browsers show the
  content without animation.
- Never put information only in motion. The toast must stay readable long enough, and the marquee
  content must also be available somewhere static, or be decorative.
