# Jassmin design: Option C+ (Bold blush, upgraded)

The storefront follows **Option C+**, chosen on 2026-10-23 in #27.

- **Design canvas:** https://claude.ai/artifact/RCvne95y2han2bw8dWm1iW (private; ask the owner for
  access). Use the row titled **"Chosen direction: Option C+"**. Options A–G stay on the canvas only
  for reference and must not be implemented.
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

Cart and checkout aren't designed yet. Build them from the tokens and components below. There is
no Unisex catalog page: catalogs are `/catalog/women` and `/catalog/men` only.

## Colour tokens

Each `--color-<name>` token in `@theme` becomes a Tailwind colour (`bg-<name>`, `text-<name>`,
`border-<name>`, …). Ratios use the WCAG 2.x formula.

| Token | Hex | Use | Contrast |
|---|---|---|---|
| `primary` | `#C22F4B` | Deep pink: sticky header, footer, primary buttons, hero bands | white text on it **5.52:1**; as text on white 5.52:1, on `blush` 5.13:1 |
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
- `primary-light` is only an accent on dark or deep-pink surfaces: the wordmark dot, decorative
  wordmarks, and text on `ink`.
- Dark mode isn't part of C+. Existing `dark:` variants may stay but aren't designed; the header and
  footer are always deep pink.

## Typeface and scale

- **Manrope** 400–800 from Google Fonts (loaded in `app/root.tsx` `links`, with Cyrillic support).
  It's first in `--font-sans`, followed by the system stack, so every Tailwind `font-sans` text uses
  it.
- **Headings:** `font-extrabold` (800) with tight negative tracking: `tracking-[-0.03em]` to
  `tracking-[-0.05em]`. Larger headings get tighter tracking, and use `leading-tight` or
  `leading-none`.
- **Suggested scale:**

  | Role | Mobile → desktop |
  |---|---|
  | Hero heading | `text-5xl` → `md:text-7xl` |
  | Page heading | `text-4xl` → `md:text-5xl` |
  | Section heading | `text-3xl` → `md:text-4xl` |
  | Card heading | `text-xl` |
  | Body | `text-base`, weight 400–500, `text-body` or `text-ink` |
  | Labels, nav | `text-sm`, weight 700 |

- **Wordmark:** "jassmin." in lower case, weight 800, `tracking-[-0.05em]`, with the dot in
  `primary-light` and marked `aria-hidden`.

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
| Deep pink (`primary`: header, footer, hero bands) | white | 5.52:1 |
| Dark (`ink`) | `primary-light` | 7.93:1 |
| White, `blush` or `card` | `primary` | 5.52:1 |

`primary-light` isn't used on deep pink, because it's only 2.55:1 there. In layout code, use
`focusRing("onPrimary" | "onLight")` from `app/components/layout/nav.ts`.

## Buttons

`Button` (a `<button>`) and `ButtonLink` (a React Router `<Link>`) share `buttonClasses()`:

| Variant | Look | Use on |
|---|---|---|
| `primary` (default) | `bg-primary`, white text, brand shadow; hover `primary-dark` | white or blush |
| `dark` | `bg-ink`, white text | light or pink-tinted sections, e.g. "Order Now" |
| `outline-light` | 2px white border, white text | deep pink (hero bands, footer) |
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
| `animate-marquee` | scroll −50% in a loop over 30s | the offer banner (render the content twice in the track) |
| `animate-toast` | slide up and fade in | the "Added to cart" popup (use `role="status"`) |
| `lift` | rise 4px with a shadow on hover | product and blog cards |
| `reveal` | fade up as it scrolls into view (`animation-timeline: view()`) | sections below the fold |

Rules:

- **Reduced motion:** one `@media (prefers-reduced-motion: reduce)` block at the end of
  `app/app.css` turns off every animation and transition. Keyframes only define their start state,
  so with motion off everything shows in its final, visible state. The button hover scale is also
  `motion-safe:`.
- `reveal` only applies inside `@supports (animation-timeline: view())`. Other browsers show the
  content without animation.
- Never put information only in motion. The toast must stay readable long enough, and the marquee
  content must also be available somewhere static, or be decorative.
