"use strict";

/**
 * Makes blog post slugs per locale (#84).
 *
 * Until #84 `blog-post.slug` wasn't localized: Strapi copied it to every locale's row, so each row
 * already holds a slug and becomes that locale's own when the field turns localized. This only
 * fills a missing or blank slug from the Ukrainian row of the same document (else any row's), so
 * no localization is left without a URL. Re-running it changes nothing; on a fresh database the
 * table doesn't exist yet and it does nothing. Editors give English posts English slugs in the
 * admin afterwards.
 */

const TABLE = "blog_posts";
/** Ukrainian is the source of truth (#43), so its slug wins. */
const LOCALE_PRIORITY = ["uk", "en"];

function rank(locale) {
  const index = LOCALE_PRIORITY.indexOf(locale);
  return index === -1 ? LOCALE_PRIORITY.length : index;
}

module.exports = {
  async up(knex) {
    if (!(await knex.schema.hasTable(TABLE))) {
      return;
    }

    await knex.transaction(async (trx) => {
      const rows = await trx(TABLE).select("id", "document_id", "locale", "slug");
      const documents = new Map();
      for (const row of rows) {
        const list = documents.get(row.document_id) ?? [];
        list.push(row);
        documents.set(row.document_id, list);
      }

      for (const [documentId, list] of documents) {
        const source = [...list]
          .sort((a, b) => rank(a.locale) - rank(b.locale))
          .find((row) => typeof row.slug === "string" && row.slug.trim() !== "");
        if (!source) {
          continue;
        }
        for (const row of list) {
          if (typeof row.slug === "string" && row.slug.trim() !== "") {
            continue;
          }
          await trx(TABLE).where({ id: row.id }).update({ slug: source.slug });
          console.info(`[#84] Blog post ${documentId} (${row.locale}): slug = ${source.slug}`);
        }
      }
    });
  },
};
