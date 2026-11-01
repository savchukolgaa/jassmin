"use strict";

/**
 * Moves the home page's hero and About photos to the shared image fields (#80).
 *
 * Until #80 the photos were `hero.image` and `about.image`, inside components localized as a
 * whole, so each locale had its own. They are now `heroImage` / `aboutImage` on the home page
 * itself (not localized: one photo for every language), with an optional per-language override in
 * the component (`imageLocalized`), which starts empty.
 *
 * For each home page document, the Ukrainian photo becomes the shared one (else the English
 * photo), linked from every locale's row, and the old component links are deleted. User
 * migrations run before Strapi's schema sync, while the old links still exist. Media links are
 * rows of the `files_related_mph` morph table, so a top-level media field needs no column and the
 * links can be written before Strapi knows the new fields. Re-running it inserts nothing; on a
 * fresh database the tables don't exist yet and it does nothing.
 */

const HOME_PAGE_UID = "api::home-page.home-page";
const MORPH_TABLE = "files_related_mph";
const SLOTS = [
  { component: "home.hero", field: "hero", sharedField: "heroImage" },
  { component: "home.about", field: "about", sharedField: "aboutImage" },
];
/** Ukrainian is the source of truth (#43), so its photo wins. */
const LOCALE_PRIORITY = ["uk", "en"];

function rank(locale) {
  const index = LOCALE_PRIORITY.indexOf(locale);
  return index === -1 ? LOCALE_PRIORITY.length : index;
}

module.exports = {
  async up(knex) {
    for (const table of ["home_pages", "home_pages_cmps", MORPH_TABLE]) {
      if (!(await knex.schema.hasTable(table))) {
        return;
      }
    }

    await knex.transaction(async (trx) => {
      const pages = await trx("home_pages").select("id", "document_id", "locale");

      for (const slot of SLOTS) {
        // The photo each home page row links from its component, e.g. `hero.image`.
        const oldLinks = await trx("home_pages_cmps as c")
          .join(`${MORPH_TABLE} as m`, function joinMorph() {
            this.on("m.related_id", "=", "c.cmp_id").andOn(
              "m.related_type",
              "=",
              "c.component_type",
            );
          })
          .where({ "c.component_type": slot.component, "c.field": slot.field, "m.field": "image" })
          .select("c.entity_id", "m.id as link_id", "m.file_id");
        const fileByPage = new Map(oldLinks.map((link) => [link.entity_id, link.file_id]));

        const documents = new Map();
        for (const page of pages) {
          const rows = documents.get(page.document_id) ?? [];
          rows.push(page);
          documents.set(page.document_id, rows);
        }

        for (const [documentId, rows] of documents) {
          const source = [...rows]
            .sort((a, b) => rank(a.locale) - rank(b.locale))
            .find((row) => fileByPage.get(row.id) != null);
          if (!source) {
            continue;
          }
          const fileId = fileByPage.get(source.id);

          for (const row of rows) {
            const linked = await trx(MORPH_TABLE)
              .where({ related_id: row.id, related_type: HOME_PAGE_UID, field: slot.sharedField })
              .first();
            if (linked) {
              continue;
            }
            await trx(MORPH_TABLE).insert({
              file_id: fileId,
              related_id: row.id,
              related_type: HOME_PAGE_UID,
              field: slot.sharedField,
              order: 1,
            });
          }
          console.info(
            `[#80] Home page ${documentId}: ${slot.sharedField} = file ${fileId} (from ${source.locale})`,
          );
        }

        // Only now that every shared link exists, drop the old per-locale ones.
        const oldIds = oldLinks.map((link) => link.link_id);
        if (oldIds.length > 0) {
          await trx(MORPH_TABLE).whereIn("id", oldIds).delete();
        }
      }
    });
  },
};
