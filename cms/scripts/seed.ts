/**
 * Seeds local Strapi content for the Jassmin app in Ukrainian (`uk`, the default locale) and
 * English (`en`): the home page, site settings, two published blog posts (one of them only in
 * `uk`, to exercise the app's fallback) and one draft. Safe to run repeatedly: existing
 * localizations (single types by locale, posts by slug and locale) are left alone, and missing
 * ones are added.
 *
 *   pnpm cms:seed               # content only
 *   pnpm cms:seed -- --token    # also creates the app's read-only API token and prints it once
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
  "api::site-setting.site-setting.find",
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
  aboutTitle: string;
  aboutBody: string;
  address: string;
  openingHours: string;
}

const HOME_PAGE_COPY: Record<SeedLocale, HomePageCopy> = {
  uk: {
    headline: "Замовте 3 тестери всього за 499₴",
    ctaLabel: "Замовити",
    aboutTitle: "Про Jassmin",
    aboutBody:
      "Jassmin — невеликий парфумерний магазин в Україні. Ми допомагаємо знайти аромат до душі: кожен парфум можна спершу спробувати як тестер, перш ніж обрати повний флакон.",
    address: "вул. Хрещатик, 1, Київ, 01001",
    openingHours: "Пн–Пт 10:00–20:00\nСб–Нд 11:00–18:00",
  },
  en: {
    headline: "Order 3 Testers only for 499₴",
    ctaLabel: "Order Now",
    aboutTitle: "About Jassmin",
    aboutBody:
      "Jassmin is a small perfume store in Ukraine. We help you find a scent you love by trying it first: every fragrance is available as a tester before you commit to a full bottle.",
    address: "1 Khreshchatyk St, Kyiv, 01001",
    openingHours: "Mon–Fri 10:00–20:00\nSat–Sun 11:00–18:00",
  },
};

async function seedHomePage(strapi: Core.Strapi, heroImageId: number): Promise<void> {
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
      },
      about: { title: copy.aboutTitle, body: copy.aboutBody },
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

async function seedApiToken(strapi: Core.Strapi): Promise<void> {
  const tokens = strapi.service("admin::api-token-content-api");
  if (await tokens.exists({ name: TOKEN_NAME })) {
    strapi.log.info(
      `API token "${TOKEN_NAME}" already exists, skipping. To get a new key, regenerate it in Settings → API Tokens.`,
    );
    return;
  }

  const token: { accessKey: string } = await tokens.create({
    name: TOKEN_NAME,
    description: "Read-only token for the Jassmin web app (find/findOne on site content)",
    type: "custom",
    lifespan: null,
    permissions: TOKEN_PERMISSIONS,
  });

  // Printed once: Strapi only stores a hash. Copy it into STRAPI_API_TOKEN in the root .env.
  console.log(`\nSTRAPI_API_TOKEN=${token.accessKey}\n`);
}

async function main(): Promise<void> {
  const withToken = process.argv.includes("--token");
  const appContext = await compileStrapi();
  const strapi = await createStrapi(appContext).load();
  strapi.log.level = "info";

  try {
    const heroImageId = await uploadImage(strapi, "hero.jpg", "Jassmin perfume testers");
    const coverImageId = await uploadImage(strapi, "blog-cover.jpg", "Perfume bottles");

    await seedHomePage(strapi, heroImageId);
    await seedSiteSettings(strapi);
    await seedBlogPosts(strapi, coverImageId);
    if (withToken) {
      await seedApiToken(strapi);
    }
  } finally {
    await strapi.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
