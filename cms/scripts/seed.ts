/**
 * Seeds local Strapi content for the Jassmin app in Ukrainian (`uk`, the default locale) and
 * English (`en`): the home page, site settings, two published blog posts (one of them only in
 * `uk`, to exercise the app's fallback), one draft, and special offers for /offers (a current
 * campaign, an expired one, a tester trio, gift ideas and two perks). Safe to run repeatedly:
 * existing localizations (single types by locale, posts and offers by slug and locale) are left
 * alone, and missing ones are added.
 *
 *   pnpm cms:seed               # content only
 *   pnpm cms:seed -- --token    # also creates the app's read-only API token and its sync token
 *                               # (products and orders, #40) and prints each once, or grants an
 *                               # existing token the permissions it's missing
 */
import { stat } from "node:fs/promises";
import path from "node:path";
import type { Core } from "@strapi/strapi";
import { compileStrapi, createStrapi } from "@strapi/strapi";

const TOKEN_NAME = "jassmin-web";

/** The only content API actions the app's token may use. */
const TOKEN_PERMISSIONS = [
  "api::blog-post.blog-post.find",
  "api::blog-post.blog-post.findOne",
  "api::home-page.home-page.find",
  "api::offer.offer.find",
  "api::site-setting.site-setting.find",
];

/** The app's sync token (#40): it pushes orders and stock to Strapi, and may only touch these. */
const SYNC_TOKEN_NAME = "jassmin-sync";

const SYNC_TOKEN_PERMISSIONS = [
  "api::product.product.find",
  "api::product.product.findOne",
  "api::product.product.create",
  "api::product.product.update",
  "api::order.order.find",
  "api::order.order.findOne",
  "api::order.order.create",
  "api::order.order.update",
];

const SEED_DATA_DIR = path.join(__dirname, "seed-data");

interface UploadedFile {
  id: number;
}

async function uploadImage(strapi: Core.Strapi, fileName: string, alt: string): Promise<number> {
  const existing: UploadedFile | null = await strapi.db
    .query("plugin::upload.file")
    .findOne({ where: { name: fileName } });
  if (existing) {
    return existing.id;
  }

  const filepath = path.join(SEED_DATA_DIR, fileName);
  const { size } = await stat(filepath);
  const [uploaded]: UploadedFile[] = await strapi
    .plugin("upload")
    .service("upload")
    .upload({
      data: { fileInfo: { name: fileName, alternativeText: alt } },
      files: { filepath, originalFilename: fileName, mimetype: "image/jpeg", size },
    });

  if (!uploaded) {
    throw new Error(`Upload of ${fileName} returned no file`);
  }
  return uploaded.id;
}

type SeedLocale = "uk" | "en";

/** Ukrainian is the default locale and the source of truth, so it's always created first. */
const SEED_LOCALES: SeedLocale[] = ["uk", "en"];

interface HomePageCopy {
  headline: string;
  ctaLabel: string;
  eyebrow: string;
  subtitle: string;
  secondaryCtaLabel: string;
  aboutTitle: string;
  aboutBody: string;
  address: string;
  openingHours: string;
}

const HOME_PAGE_COPY: Record<SeedLocale, HomePageCopy> = {
  uk: {
    headline: "Замовте 3 тестери всього за 499₴",
    ctaLabel: "Замовити",
    eyebrow: "Тестерний набір",
    subtitle: "Замовте 3 тестери всього за 499₴ і знайдіть той, що вартий повного флакона.",
    secondaryCtaLabel: "Усі парфуми",
    aboutTitle: "Про Jassmin",
    aboutBody:
      "Jassmin — невеликий парфумерний магазин в Україні. Ми допомагаємо знайти аромат до душі: кожен парфум можна спершу спробувати як тестер, перш ніж обрати повний флакон.",
    address: "вул. Хрещатик, 1, Київ, 01001",
    openingHours: "Пн–Пт 10:00–20:00\nСб–Нд 11:00–18:00",
  },
  en: {
    headline: "Order 3 Testers only for 499₴",
    ctaLabel: "Order Now",
    eyebrow: "Tester set",
    subtitle: "Order 3 testers only for 499₴, and find the one worth a full bottle.",
    secondaryCtaLabel: "See all perfumes",
    aboutTitle: "About Jassmin",
    aboutBody:
      "Jassmin is a small perfume store in Ukraine. We help you find a scent you love by trying it first: every fragrance is available as a tester before you commit to a full bottle.",
    address: "1 Khreshchatyk St, Kyiv, 01001",
    openingHours: "Mon–Fri 10:00–20:00\nSat–Sun 11:00–18:00",
  },
};

async function seedHomePage(
  strapi: Core.Strapi,
  heroImageId: number,
  aboutImageId: number,
): Promise<void> {
  const homePages = strapi.documents("api::home-page.home-page");

  for (const locale of SEED_LOCALES) {
    if (await homePages.findFirst({ locale })) {
      strapi.log.info(`Home page (${locale}) already exists, skipping`);
      continue;
    }

    const copy = HOME_PAGE_COPY[locale];
    // The hero and location components are localized as a whole, so every locale gets its own
    // copy of the image, link and map URL.
    const data = {
      hero: {
        headline: copy.headline,
        ctaLabel: copy.ctaLabel,
        ctaHref: "/popular",
        image: heroImageId,
        eyebrow: copy.eyebrow,
        subtitle: copy.subtitle,
        secondaryCtaLabel: copy.secondaryCtaLabel,
        secondaryCtaHref: "/catalog/women",
      },
      about: { title: copy.aboutTitle, body: copy.aboutBody, image: aboutImageId },
      location: {
        address: copy.address,
        openingHours: copy.openingHours,
        mapEmbedUrl: "https://www.google.com/maps?q=Khreshchatyk+1+Kyiv&output=embed",
      },
    };
    const existing = await homePages.findFirst({ locale: "uk" });
    if (existing) {
      await homePages.update({ documentId: existing.documentId, locale, data });
    } else {
      await homePages.create({ locale, data });
    }
    strapi.log.info(`Created home page (${locale})`);
  }
}

const CUSTOMER_SERVICE_HOURS: Record<SeedLocale, string> = {
  uk: "Пн–Пт 9:00–18:00",
  en: "Mon–Fri 9:00–18:00",
};

async function seedSiteSettings(strapi: Core.Strapi): Promise<void> {
  const settings = strapi.documents("api::site-setting.site-setting");

  for (const locale of SEED_LOCALES) {
    if (await settings.findFirst({ locale })) {
      strapi.log.info(`Site settings (${locale}) already exist, skipping`);
      continue;
    }

    // Phone, email and social links aren't localized: Strapi copies them to every locale.
    const data = {
      phone: "+380 44 123 45 67",
      email: "hello@jassmin.ua",
      customerServiceHours: CUSTOMER_SERVICE_HOURS[locale],
      socialLinks: [
        { platform: "instagram" as const, url: "https://www.instagram.com/jassmin" },
        { platform: "telegram" as const, url: "https://t.me/jassmin" },
      ],
    };
    const existing = await settings.findFirst({ locale: "uk" });
    if (existing) {
      await settings.update({ documentId: existing.documentId, locale, data });
    } else {
      await settings.create({ locale, data });
    }
    strapi.log.info(`Created site settings (${locale})`);
  }
}

interface PostCopy {
  title: string;
  excerpt: string;
  content: string;
  authorName: string;
}

interface SeedPost {
  slug: string;
  published: boolean;
  /** `uk` is required; a post without `en` exercises the app's fallback to Ukrainian. */
  copy: { uk: PostCopy; en?: PostCopy };
}

const POSTS: SeedPost[] = [
  {
    slug: "how-to-choose-a-perfume",
    published: true,
    copy: {
      uk: {
        title: "Як обрати парфум, який не набридне",
        excerpt:
          "Верхні, серцеві та базові ноти, і чому варто зачекати годину, перш ніж вирішувати.",
        content:
          "## Почніть із нот\n\nПарфум змінюється, поки висихає. **Верхні ноти** зникають за кілька хвилин, **серце** тримається кілька годин, а **база** — увесь день.\n\n## Тестуйте на шкірі\n\nПаперові блотери показують лише верхні ноти. Нанесіть тестер на зап’ястя й зачекайте щонайменше годину.",
        authorName: "Команда Jassmin",
      },
      en: {
        title: "How to choose a perfume you won't get tired of",
        excerpt: "Top, heart and base notes, and why you should wait an hour before you decide.",
        content:
          "## Start with the notes\n\nA perfume changes as it dries. The **top notes** fade within minutes, the **heart** lasts a few hours and the **base** stays all day.\n\n## Test on skin\n\nPaper strips only show the top notes. Spray a tester on your wrist and wait at least an hour.",
        authorName: "Jassmin team",
      },
    },
  },
  {
    slug: "fragrance-families-explained",
    published: true,
    copy: {
      uk: {
        title: "Родини ароматів: коротко й зрозуміло",
        excerpt: "Квіткові, деревні, орієнтальні та свіжі: коротка мапа колеса ароматів.",
        content:
          "Більшість парфумів належить до однієї з чотирьох родин:\n\n- **Квіткові**: троянда, жасмин, півонія\n- **Деревні**: сандал, кедр, ветивер\n- **Орієнтальні**: ваніль, амбра, спеції\n- **Свіжі**: цитрусові, зелені та водні ноти",
        authorName: "Команда Jassmin",
      },
    },
  },
  {
    slug: "summer-scents-draft",
    published: false,
    copy: {
      uk: {
        title: "Літні аромати (чернетка)",
        excerpt: "Ще не опубліковано: застосунок ніколи не має показувати цей допис.",
        content: "Робота триває.",
        authorName: "Команда Jassmin",
      },
    },
  },
];

async function seedBlogPosts(strapi: Core.Strapi, coverImageId: number): Promise<void> {
  const posts = strapi.documents("api::blog-post.blog-post");

  for (const post of POSTS) {
    for (const locale of SEED_LOCALES) {
      const copy = post.copy[locale];
      if (!copy) {
        continue;
      }

      // Every document has a draft version, so this finds both published and draft-only posts.
      if (await posts.findFirst({ filters: { slug: post.slug }, locale, status: "draft" })) {
        strapi.log.info(`Blog post "${post.slug}" (${locale}) already exists, skipping`);
        continue;
      }

      // The slug and cover image aren't localized: Strapi keeps them the same in every locale,
      // but a new localization still has to be given them.
      const data = {
        ...copy,
        slug: post.slug,
        coverImage: coverImageId,
        seo: { metaTitle: copy.title.slice(0, 60), metaDescription: copy.excerpt.slice(0, 160) },
      };
      const status = post.published ? { status: "published" as const } : {};
      const ukVersion =
        locale === "uk"
          ? null
          : await posts.findFirst({ filters: { slug: post.slug }, locale: "uk", status: "draft" });
      if (ukVersion) {
        await posts.update({ documentId: ukVersion.documentId, locale, data, ...status });
      } else {
        await posts.create({ locale, data, ...status });
      }
      strapi.log.info(
        `Created ${post.published ? "published" : "draft"} blog post "${post.slug}" (${locale})`,
      );
    }
  }
}

type OfferKind =
  | "discovery-set"
  | "seasonal"
  | "gift"
  | "bundle"
  | "featured"
  | "last-units"
  | "perk";

interface OfferCopy {
  title: string;
  summary: string;
  body?: string;
  priceNote?: string;
  ctaLabel?: string;
}

interface SeedOffer {
  slug: string;
  kind: OfferKind;
  image?: "hero" | "cover";
  /** ISO 8601 with an offset; left out, there is no limit on that side. */
  startsAt?: string;
  endsAt?: string;
  /** `public_id`s from the app's DB seed (`app/.server/db/seed-data.ts`). */
  productIds: string[];
  ctaUrl?: string;
  sortOrder: number;
  /** `uk` is required; an offer without `en` exercises the app's fallback to Ukrainian. */
  copy: { uk: OfferCopy; en?: OfferCopy };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Midnight in Kyiv `days` from now, with Kyiv's offset on that day (UTC+2 in winter, UTC+3 in
 * summer), so the seeded campaigns are current or expired whenever the seed runs.
 */
function kyivMidnight(days: number): string {
  const target = new Date(Date.now() + days * DAY_MS);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(target);
  const zone = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Kyiv",
    timeZoneName: "longOffset",
  })
    .formatToParts(target)
    .find((part) => part.type === "timeZoneName")?.value;
  const offset = zone?.replace("GMT", "") || "+00:00";
  return `${date}T00:00:00${offset}`;
}

const LA_VIE_EST_BELLE = "01a1652b-6e25-7c39-a4ce-d1efe1e47081";
const JADORE = "01a1652b-6e25-7c3f-9567-5f694e414a33";
const SAUVAGE = "01a1652b-6e25-7c44-8d5b-bce46a20ad83";
const BLEU_DE_CHANEL = "01a1652b-6e25-7c48-8efe-b797385135f1";
const MOLECULE_01 = "01a1652b-6e25-7c55-8003-478f2d6abfb1";
/** Not in the app's DB: shows that offers skip products that no longer exist. */
const MISSING_PRODUCT = "01a1652b-6e25-7fff-8000-000000000000";

// Offers are editorial: price notes describe what goes in the cart. The tester trio's price is
// the app's `tester-trio` discount rule (#59), which checkout applies by itself; keep the two in
// sync.
const OFFERS: SeedOffer[] = [
  {
    slug: "winter-holidays",
    kind: "seasonal",
    image: "hero",
    startsAt: kyivMidnight(-1),
    endsAt: kyivMidnight(60),
    productIds: [JADORE, BLEU_DE_CHANEL],
    ctaUrl: "/catalog/women",
    sortOrder: 0,
    copy: {
      uk: {
        title: "Зимові свята з Jassmin",
        summary: "Від Миколая до Різдва: аромати, які хочеться дарувати.",
        body: "Оберіть подарунок заздалегідь: **маленькі об’єми** зручно покласти під подушку на День святого Миколая, а повний флакон — під ялинку.",
        ctaLabel: "Обрати подарунок",
      },
      en: {
        title: "Winter holidays with Jassmin",
        summary: "From St Nicholas Day to Christmas: scents worth giving.",
        body: "Choose a gift early: **small sizes** fit under the pillow on St Nicholas Day, and a full bottle goes under the tree.",
        ctaLabel: "Find a gift",
      },
    },
  },
  {
    slug: "tester-trio",
    kind: "discovery-set",
    image: "hero",
    // Products with a 10 ml size in stock.
    productIds: [LA_VIE_EST_BELLE, SAUVAGE, MOLECULE_01],
    ctaUrl: "/catalog/women",
    sortOrder: 10,
    copy: {
      uk: {
        title: "Тестерне тріо",
        summary: "Три аромати по 10 мл за 499 ₴: найпростіший спосіб знайти свій.",
        body: "Додайте до кошика будь-які три об’єми по 10 мл, і кошик порахує їх за 499 ₴. До трьох тріо в одному замовленні. Носіть кожен аромат кілька днів, перш ніж обрати повний флакон.",
        priceNote: "3 × 10 мл — 499 ₴",
        ctaLabel: "Зібрати тріо",
      },
      en: {
        title: "Tester trio",
        summary: "Three 10 ml scents for 499 ₴: the easiest way to find yours.",
        body: "Add any three 10 ml sizes to your cart and it charges 499 ₴ for them, up to three trios per order. Wear each scent for a few days before you choose a full bottle.",
        priceNote: "3 × 10 ml — 499 ₴",
        ctaLabel: "Build my trio",
      },
    },
  },
  {
    slug: "gifts-by-budget",
    kind: "gift",
    image: "cover",
    productIds: [SAUVAGE, LA_VIE_EST_BELLE, MISSING_PRODUCT],
    ctaUrl: "/catalog/men",
    sortOrder: 20,
    copy: {
      uk: {
        title: "Подарунки за бюджетом",
        summary: "Ідеї до 500, 1000 і 2000 ₴ — для неї та для нього.",
        body: "- **До 500 ₴**: мініатюри 7 мл\n- **До 1000 ₴**: 10 мл улюбленого аромату\n- **До 2000 ₴**: 30 мл класики",
        ctaLabel: "Подарунки для нього",
      },
      en: {
        title: "Gifts by budget",
        summary: "Ideas up to 500, 1000 and 2000 ₴, for her and for him.",
        body: "- **Up to 500 ₴**: 7 ml minis\n- **Up to 1000 ₴**: 10 ml of a favourite scent\n- **Up to 2000 ₴**: 30 ml of a classic",
        ctaLabel: "Gifts for him",
      },
    },
  },
  {
    slug: "free-delivery",
    kind: "perk",
    productIds: [],
    sortOrder: 0,
    copy: {
      uk: { title: "Безкоштовна доставка", summary: "Новою Поштою від 1000 ₴" },
      en: { title: "Free delivery", summary: "With Nova Poshta from 1000 ₴" },
    },
  },
  {
    slug: "discovery-sizes",
    kind: "perk",
    productIds: [],
    ctaUrl: "/catalog/women",
    sortOrder: 10,
    copy: {
      uk: { title: "Спершу спробуйте", summary: "Кожен аромат є в об’ємах від 7 мл" },
      en: { title: "Try it first", summary: "Every scent comes in sizes from 7 ml" },
    },
  },
  {
    slug: "welcome-offer",
    kind: "perk",
    productIds: [],
    ctaUrl: "/register",
    sortOrder: 20,
    copy: {
      uk: {
        title: "Вітаємо в Jassmin",
        summary: "Зареєструйтеся, щоб стежити за замовленнями",
        ctaLabel: "Зареєструватися",
      },
      en: {
        title: "Welcome to Jassmin",
        summary: "Register to keep track of your orders",
        ctaLabel: "Register",
      },
    },
  },
  {
    // Ended before the seed ran: the app must never show it.
    slug: "back-to-school-ended",
    kind: "seasonal",
    image: "cover",
    startsAt: kyivMidnight(-90),
    endsAt: kyivMidnight(-30),
    productIds: [SAUVAGE],
    ctaUrl: "/catalog/men",
    sortOrder: 0,
    copy: {
      uk: {
        title: "Осінь, школа, нові аромати (завершено)",
        summary: "Ця кампанія вже закінчилася: застосунок ніколи не має її показувати.",
      },
    },
  },
];

async function seedOffers(
  strapi: Core.Strapi,
  images: { hero: number; cover: number },
): Promise<void> {
  const offers = strapi.documents("api::offer.offer");

  for (const offer of OFFERS) {
    for (const locale of SEED_LOCALES) {
      const copy = offer.copy[locale];
      if (!copy) {
        continue;
      }

      if (await offers.findFirst({ filters: { slug: offer.slug }, locale, status: "draft" })) {
        strapi.log.info(`Offer "${offer.slug}" (${locale}) already exists, skipping`);
        continue;
      }

      // Kind, dates, image, products, link and order aren't localized: Strapi keeps them the same
      // in every locale, but a new localization still has to be given them.
      const data = {
        ...copy,
        slug: offer.slug,
        kind: offer.kind,
        image: offer.image ? images[offer.image] : null,
        startsAt: offer.startsAt,
        endsAt: offer.endsAt,
        products: offer.productIds.map((publicId) => ({ publicId })),
        ctaUrl: offer.ctaUrl,
        sortOrder: offer.sortOrder,
      };
      const ukVersion =
        locale === "uk"
          ? null
          : await offers.findFirst({
              filters: { slug: offer.slug },
              locale: "uk",
              status: "draft",
            });
      if (ukVersion) {
        await offers.update({
          documentId: ukVersion.documentId,
          locale,
          data,
          status: "published",
        });
      } else {
        await offers.create({ locale, data, status: "published" });
      }
      strapi.log.info(`Created offer "${offer.slug}" (${locale})`);
    }
  }
}

interface SeedToken {
  name: string;
  description: string;
  permissions: string[];
  /** The root `.env` variable the printed key goes into. */
  envName: string;
}

const APP_TOKENS: SeedToken[] = [
  {
    name: TOKEN_NAME,
    description: "Read-only token for the Jassmin web app (find/findOne on site content)",
    permissions: TOKEN_PERMISSIONS,
    envName: "STRAPI_API_TOKEN",
  },
  {
    name: SYNC_TOKEN_NAME,
    description: "Sync token for the Jassmin web app: pushes orders and product stock (#40)",
    permissions: SYNC_TOKEN_PERMISSIONS,
    envName: "STRAPI_SYNC_TOKEN",
  },
];

async function seedApiToken(strapi: Core.Strapi, seed: SeedToken): Promise<void> {
  const tokens = strapi.service("admin::api-token-content-api");
  // Strapi 5.59's content API token service has `getByName`; the generic `getBy` is gone.
  const existing: { id: number; permissions?: string[] } | null = await tokens.getByName(seed.name);
  if (existing) {
    // Content types added after the token was created (offers, #55) need their permissions too.
    // The key itself stays the same.
    const granted = existing.permissions ?? [];
    const missing = seed.permissions.filter((action) => !granted.includes(action));
    if (missing.length > 0) {
      await tokens.update(existing.id, { permissions: [...granted, ...missing] });
      strapi.log.info(`Granted API token "${seed.name}": ${missing.join(", ")}`);
    }
    strapi.log.info(
      `API token "${seed.name}" already exists. To get a new key, regenerate it in Settings → API Tokens.`,
    );
    return;
  }

  const token: { accessKey: string } = await tokens.create({
    name: seed.name,
    description: seed.description,
    type: "custom",
    lifespan: null,
    permissions: seed.permissions,
  });

  // Printed once: Strapi only stores a hash. Copy it into the root .env.
  console.log(`\n${seed.envName}=${token.accessKey}\n`);
}

async function main(): Promise<void> {
  const withToken = process.argv.includes("--token");
  const appContext = await compileStrapi();
  const strapi = await createStrapi(appContext).load();
  strapi.log.level = "info";

  try {
    const heroImageId = await uploadImage(strapi, "hero.jpg", "Jassmin perfume testers");
    const coverImageId = await uploadImage(strapi, "blog-cover.jpg", "Perfume bottles");

    await seedHomePage(strapi, heroImageId, coverImageId);
    await seedSiteSettings(strapi);
    await seedBlogPosts(strapi, coverImageId);
    await seedOffers(strapi, { hero: heroImageId, cover: coverImageId });
    if (withToken) {
      for (const token of APP_TOKENS) {
        await seedApiToken(strapi, token);
      }
    }
  } finally {
    await strapi.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
