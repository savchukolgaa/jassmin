# Screenshots

Images for the project [README](../../README.md). None are committed yet: they are taken once the
synthetic shop data from [#131](https://github.com/savchukolgaa/jassmin/issues/131) exists.

## Rules

- **Synthetic data only.** Take every screenshot on a database filled with synthetic data, never on
  a copy of the live shop. No real names, emails, phone numbers, addresses or orders may appear,
  including in the browser's address bar, autofill or open tabs.
- **WebP, under 200 KB each.**
- Ukrainian (the default language) unless a shot is meant to show the English version.

## Shot list

| Page | Desktop (1440 × 900) | Phone (390 × 844) |
|------|----------------------|-------------------|
| Home | `home-desktop.webp` | `home-phone.webp` |
| Catalog (`/katalog/zhinochi`) | `catalog-desktop.webp` | `catalog-phone.webp` |
| Product page | `product-desktop.webp` | `product-phone.webp` |
| Cart, with a discount applied | `cart-desktop.webp` | `cart-phone.webp` |
| Checkout | `checkout-desktop.webp` | `checkout-phone.webp` |

`home-desktop.webp` and `home-phone.webp` are the README's hero; the others go in a gallery under it.

## Taking them

1. Run a production build on the synthetic database: `pnpm build`, then `pnpm start` with
   `DATABASE_URL` pointing at it, and Strapi seeded (`pnpm cms:seed`).
2. In Chrome DevTools, set the device toolbar to the size above (DPR 1 for desktop, 2 for phone),
   accept or decline the cookie banner so it's not in the shot, and use **Capture screenshot**
   (viewport, not full page, for the hero).
3. Convert and shrink, for example with `cwebp -q 80 in.png -o home-desktop.webp`, or
   `pnpm dlx sharp-cli -i in.png -o home-desktop.webp -f webp -q 80`. Lower the quality until the
   file is under 200 KB.
4. Look at every image at full size for personal data before committing it.
5. In the README, replace the hero placeholder comment and the "Screenshots coming soon" line with
   the desktop and phone images (with `alt` text), and add the gallery.
