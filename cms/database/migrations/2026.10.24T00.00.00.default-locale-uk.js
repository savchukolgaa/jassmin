"use strict";

/**
 * Makes Ukrainian the default locale before i18n is enabled on the Jassmin content types (#43).
 *
 * Strapi creates `en` as the default locale, and when a content type becomes localized it tags
 * the existing rows with the default locale during schema sync. User migrations run before that
 * sync, so switching the default to `uk` here keeps the existing (Ukrainian) content as `uk`.
 * Rows already tagged `en` without a `uk` sibling (a database booted with i18n before this
 * migration) are re-tagged too. On a fresh database the tables don't exist yet and this does
 * nothing; `cms/src/index.ts` then creates the locales at bootstrap.
 */

const crypto = require("node:crypto");

const DEFAULT_LOCALE = "uk";
const CONTENT_TABLES = ["blog_posts", "home_pages", "site_settings"];
const DOCUMENT_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** A 24-character lowercase id, like the ones Strapi generates for `document_id`. */
function documentId() {
  return Array.from(
    crypto.randomBytes(24),
    (byte) => DOCUMENT_ID_ALPHABET[byte % DOCUMENT_ID_ALPHABET.length],
  ).join("");
}

module.exports = {
  async up(knex) {
    if (!(await knex.schema.hasTable("i18n_locale"))) {
      return;
    }

    const existing = await knex("i18n_locale").where({ code: DEFAULT_LOCALE }).first();
    if (!existing) {
      const now = new Date();
      await knex("i18n_locale").insert({
        document_id: documentId(),
        name: "Ukrainian (uk)",
        code: DEFAULT_LOCALE,
        created_at: now,
        updated_at: now,
        published_at: now,
      });
    }

    const store = { key: "plugin_i18n_default_locale" };
    const value = JSON.stringify(DEFAULT_LOCALE);
    if (await knex("strapi_core_store_settings").where(store).first()) {
      await knex("strapi_core_store_settings").where(store).update({ value });
    } else {
      await knex("strapi_core_store_settings").insert({ ...store, value, type: "string" });
    }

    for (const table of CONTENT_TABLES) {
      if (!(await knex.schema.hasColumn(table, "locale"))) {
        continue;
      }
      await knex(table).whereNull("locale").update({ locale: DEFAULT_LOCALE });
      await knex(table)
        .where({ locale: "en" })
        .whereNotIn(
          "document_id",
          knex(table).select("document_id").where({ locale: DEFAULT_LOCALE }),
        )
        .update({ locale: DEFAULT_LOCALE });
    }
  },
};
