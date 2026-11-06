# Product feeds: Google Shopping and Instagram Shopping

The shop serves a product feed: a list of every perfume size on sale, with its price, stock and
photo. Google Merchant Center and Meta Commerce Manager fetch it on a schedule (#140). Google uses
it for free listings in Google Shopping and Search, and Meta uses it for a catalog whose products
can be tagged in Instagram and Facebook posts.

| Feed | URL | Language |
|---|---|---|
| Main | `https://jassmin.ua/feeds/products.xml` | Ukrainian |
| English | `https://jassmin.ua/en/feeds/products.xml` | English |

Both are in Google's RSS 2.0 format, which Meta reads as well, so one URL serves both platforms.
The accounts are set up once by the owner, in the browser, following this guide. No code changes
are needed. Menu names in both tools change from time to time: look for the closest match.

## Contents

1. [What's in the feed](#whats-in-the-feed)
2. [Before you start: is it available in Ukraine?](#1-before-you-start-is-it-available-in-ukraine)
3. [Google Merchant Center](#2-google-merchant-center)
4. [Meta Commerce Manager (Instagram Shopping)](#3-meta-commerce-manager-instagram-shopping)
5. [Reading feed errors](#4-reading-feed-errors)
6. [Checking the feed yourself](#5-checking-the-feed-yourself)
7. [How it works in the code](#how-it-works-in-the-code)

## What's in the feed

There is one item per **perfume size**. A perfume with five sizes is five items, grouped by
`item_group_id`. A perfume is included when it is active (not archived in Strapi), has a URL slug
and has sizes with a price above 0.

| Field | Value | From |
|---|---|---|
| `g:id` | The size's id (UUID) | `product_variants.public_id` |
| `g:item_group_id` | The perfume's id (UUID) | `products.public_id` |
| `title` | `Dior Sauvage — розпив, 10 мл` (`… — decant, 10 ml` in English) | brand, name and size |
| `description` | "Оригінальний аромат … розлитий у флакон JASSMIN, 10 мл." plus the perfume's description | `description` / `description_en` |
| `link` | The product page, e.g. `https://jassmin.ua/parfumy/dior-sauvage` | slug |
| `g:image_link` | The perfume's own photo if it has one, otherwise the shop's bottle photo (JPEG, 1280×1600) | Strapi photo / bottle photo |
| `g:price` | `629.00 UAH` | the size's price |
| `g:availability` | `in_stock` / `out_of_stock` | stock; sizes that don't track stock are always in stock |
| `g:brand` | The perfume house, e.g. `Dior` | `brand` |
| `g:condition` / `g:identifier_exists` | `new` / `no` (decants have no barcode) | fixed |
| `g:google_product_category` | `479` (Perfume & Cologne) | fixed |
| `g:product_type` | `Жіночі парфуми > Квіткові` | gender and main fragrance family |
| `g:gender`, `g:size` | `female`, `10 мл` | gender, size |
| `g:free_shipping_threshold` | `UA`, `1500.00 UAH` | free delivery from 1500 ₴ |

The feed is cached for **one hour**, so it's never more than an hour behind the shop. It is not
blocked in `robots.txt` (Google's and Meta's fetchers obey it), but it carries
`X-Robots-Tag: noindex`, so it never shows up as a search result.

## 1. Before you start: is it available in Ukraine?

The feed works in any country, but each platform decides where its shopping features are offered.

- **Google:** in Merchant Center, check that **free listings** (free product listings) can target
  Ukraine with prices in UAH. Google publishes the list of supported countries in the Merchant
  Center Help.
- **Meta:** Instagram product tags need **Instagram Shopping**, which is only offered in some
  markets. Check Meta's eligibility list for Ukraine before spending time on the Meta setup. If
  it isn't available, a catalog is still useful later for catalog ads. Ads are out of scope here.

## 2. Google Merchant Center

1. **Create the account** at merchants.google.com with the shop's Google account. Enter the
   business name **JASSMIN**, the country **Ukraine**, the website `https://jassmin.ua` and the
   contact details from the site's footer.
2. **Verify and claim the website.** The simplest way is **DNS**: Merchant Center gives you a TXT
   record, and whoever manages the `jassmin.ua` DNS zone adds it (as for email, see
   [email.md](email.md)). If the domain is already verified in Google Search Console with the same
   Google account, Merchant Center can use that instead. Then click **Claim**.
3. **Shipping** (account level, not in the feed). Go to *Settings → Shipping and returns* and add
   a shipping service:
   - Country: Ukraine. Name: "Нова пошта". Currency: UAH.
   - Delivery time: the usual Nova Poshta times, e.g. 1–3 days.
   - Cost: Nova Poshta's typical rate for a small parcel (check the current tariff), and **free
     for orders of 1500 UAH and more**.

   The shop doesn't charge for delivery: below 1500 ₴ the customer pays Nova Poshta when collecting
   the parcel. Google still needs a shipping cost, so give the typical rate here. Never enter 0 for
   orders below 1500 ₴, or Google will flag the listings as misleading.
4. **Returns:** add the shop's return policy (*Settings → Shipping and returns → Returns*), using
   the same terms as on the site.
5. **Add the feed:** *Products → Add products → Add products from a file → Enter a link to your
   file*:
   - URL: `https://jassmin.ua/feeds/products.xml`
   - Country: Ukraine. Language: Ukrainian.
   - Fetch frequency: **daily** (pick a quiet time, e.g. 04:00).
   - Optionally, add a second source with `https://jassmin.ua/en/feeds/products.xml` and the
     language English. It helps English searches, but Ukrainian is the main one.
6. **Automatic item updates** (*Settings → Automatic improvements*): turn on the price and
   availability updates. Google then corrects prices and stock between fetches from the product
   data that every product page already includes (#86).
7. **Free listings:** under *Growth → Manage programs*, turn on **Free listings**. Items show up
   in Google Shopping after Google reviews them, which usually takes a few days.

## 3. Meta Commerce Manager (Instagram Shopping)

1. **Business account:** the shop needs a Meta Business account (business.facebook.com) that owns
   the Facebook page and the Instagram professional account.
2. **Verify the domain:** *Business settings → Brand safety → Domains → Add* `jassmin.ua`, and
   choose the **DNS TXT record** method. Add the record to the DNS zone, then click **Verify**.
3. **Create a catalog:** in Commerce Manager, *Create catalog → E-commerce*, and name it
   "JASSMIN".
4. **Add the feed:** *Catalog → Data sources → Add items → Data feed → Scheduled feed*:
   - URL: `https://jassmin.ua/feeds/products.xml`
   - Schedule: **hourly** (or daily).
   - Currency: UAH.

   Meta reads the same Google format, including `item_group_id` (your sizes appear as variants of
   one product).
5. **Shop and Instagram:** if Instagram Shopping is offered in Ukraine (step 1), create a shop
   with this catalog and connect the Instagram account. The account goes through a review, and
   after approval you can tag products in posts and Reels.

## 4. Reading feed errors

- **Google:** *Products → Diagnostics* lists problems per item or for the whole feed, and
  *Products → Data sources* shows the last fetch and its result. Click an issue to see which items
  it affects and what to fix.
- **Meta:** *Catalog → Issues* and *Data sources → (the feed) → Upload history*.

Common problems and what to do:

| Problem | What to do |
|---|---|
| Image too small, or image can't be crawled | The bottle photo is 1280×1600 JPEG. Check that `https://jassmin.ua/assets/…jpg` from the feed opens in the browser. |
| Price or availability mismatch | The page and the feed disagree, usually right after an edit in Strapi. The feed refreshes within an hour; Google re-checks on its next fetch. |
| Missing shipping information | Add the shipping service (Google step 3). |
| **Brand or trademark disapprovals** (e.g. "Counterfeit goods", "Misrepresentation", "Trademark") | The feed sends the perfume house as `g:brand`, and says "розпив / decant" in the title and description. If items are still disapproved, ask the platform to re-review: these are genuine perfumes decanted into a smaller bottle. If that doesn't help, a developer can change `feedBrand` in `app/.server/services/product-feed.ts` to return `"JASSMIN"`. |
| Products missing from the feed | Only active perfumes with a slug and a price above 0 are included. Archived products are left out on purpose. |

## 5. Checking the feed yourself

```bash
curl -I https://jassmin.ua/feeds/products.xml
# 200, Content-Type: application/xml; charset=utf-8,
# Cache-Control: public, max-age=3600, X-Robots-Tag: noindex
curl -s https://jassmin.ua/feeds/products.xml | grep -c "<item>"
```

The number of items should be the total number of sizes of all perfumes on sale. Opening the URL
in a browser shows the XML. If the browser reports an error, the feed is broken: report it to a
developer.

## How it works in the code

- `app/routes/feeds.products.xml.ts`: the resource route for both URLs. The language comes from
  the path. It reads the database first, then streams the XML.
- `app/.server/services/product-feed.ts`: turns database rows into items (title, description,
  images, brand, product type).
- `app/.server/seo/product-feed.ts`: writes the RSS XML. Every text is escaped, and characters XML
  forbids are removed (`app/.server/seo/xml.ts`).
- `app/.server/db/queries/products.ts` → `listFeedVariants`: which sizes are included.
- Copy (titles, the decant note, gender names) is in `app/lib/i18n/{uk,en}.ts` under `feed`.
