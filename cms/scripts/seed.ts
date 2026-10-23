/**
 * Seeds local Strapi content for the Jassmin app: the home page, site settings, two published
 * blog posts and one draft. Safe to run repeatedly: existing single types and posts (matched by
 * slug) are left alone.
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

async function seedHomePage(strapi: Core.Strapi, heroImageId: number): Promise<void> {
  const homePages = strapi.documents("api::home-page.home-page");
  if (await homePages.findFirst()) {
    strapi.log.info("Home page already exists, skipping");
    return;
  }

  await homePages.create({
    data: {
      hero: {
        headline: "Order 3 Testers only for 499₴",
        ctaLabel: "Order Now",
        ctaHref: "/popular",
        image: heroImageId,
      },
      about: {
        title: "About Jassmin",
        body: "Jassmin is a small perfume store in Ukraine. We help you find a scent you love by trying it first: every fragrance is available as a tester before you commit to a full bottle.",
      },
      location: {
        address: "вул. Хрещатик, 1, Київ, 01001",
        openingHours: "Mon–Fri 10:00–20:00\nSat–Sun 11:00–18:00",
        mapEmbedUrl: "https://www.google.com/maps?q=Khreshchatyk+1+Kyiv&output=embed",
      },
    },
  });
  strapi.log.info("Created home page");
}

async function seedSiteSettings(strapi: Core.Strapi): Promise<void> {
  const settings = strapi.documents("api::site-setting.site-setting");
  if (await settings.findFirst()) {
    strapi.log.info("Site settings already exist, skipping");
    return;
  }

  await settings.create({
    data: {
      phone: "+380 44 123 45 67",
      email: "hello@jassmin.ua",
      customerServiceHours: "Mon–Fri 9:00–18:00",
      socialLinks: [
        { platform: "instagram", url: "https://www.instagram.com/jassmin" },
        { platform: "telegram", url: "https://t.me/jassmin" },
      ],
    },
  });
  strapi.log.info("Created site settings");
}

interface SeedPost {
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  authorName: string;
  published: boolean;
}

const POSTS: SeedPost[] = [
  {
    slug: "how-to-choose-a-perfume",
    title: "How to choose a perfume you won't get tired of",
    excerpt: "Top, heart and base notes, and why you should wait an hour before you decide.",
    content:
      "## Start with the notes\n\nA perfume changes as it dries. The **top notes** fade within minutes, the **heart** lasts a few hours and the **base** stays all day.\n\n## Test on skin\n\nPaper strips only show the top notes. Spray a tester on your wrist and wait at least an hour.",
    authorName: "Jassmin team",
    published: true,
  },
  {
    slug: "fragrance-families-explained",
    title: "Fragrance families explained",
    excerpt: "Floral, woody, oriental and fresh: a quick map of the fragrance wheel.",
    content:
      "Most perfumes belong to one of four families:\n\n- **Floral**: rose, jasmine, peony\n- **Woody**: sandalwood, cedar, vetiver\n- **Oriental**: vanilla, amber, spices\n- **Fresh**: citrus, green and aquatic notes",
    authorName: "Jassmin team",
    published: true,
  },
  {
    slug: "summer-scents-draft",
    title: "Summer scents (draft)",
    excerpt: "Not published yet: the app must never show this post.",
    content: "Work in progress.",
    authorName: "Jassmin team",
    published: false,
  },
];

async function seedBlogPosts(strapi: Core.Strapi, coverImageId: number): Promise<void> {
  const posts = strapi.documents("api::blog-post.blog-post");

  for (const post of POSTS) {
    // Every document has a draft version, so this finds both published and draft-only posts.
    if (await posts.findFirst({ filters: { slug: post.slug }, status: "draft" })) {
      strapi.log.info(`Blog post "${post.slug}" already exists, skipping`);
      continue;
    }

    const { published, ...fields } = post;
    await posts.create({
      data: {
        ...fields,
        coverImage: coverImageId,
        seo: { metaTitle: post.title.slice(0, 60), metaDescription: post.excerpt.slice(0, 160) },
      },
      ...(published ? { status: "published" as const } : {}),
    });
    strapi.log.info(`Created ${published ? "published" : "draft"} blog post "${post.slug}"`);
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
