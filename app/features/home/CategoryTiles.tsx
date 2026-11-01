import { Link } from "react-router";
import { focusRing } from "~/components/layout/nav";
import { cn } from "~/lib/cn";
import { usePathFor, useT } from "~/lib/i18n";

// Only two catalogs: there is no Unisex one (unisex perfumes are in both).
const TILES = [
  {
    gender: "women",
    label: "home.tiles.women",
    tile: "bg-blush text-ink",
    arrow: "text-primary-dark",
  },
  {
    gender: "men",
    label: "home.tiles.men",
    tile: "bg-ink text-white",
    arrow: "text-primary-light",
  },
] as const;

/** Big Women / Men tiles linking to the two catalogs. */
export function CategoryTiles() {
  const { t } = useT();
  const path = usePathFor();
  return (
    <nav aria-label={t("home.tiles.label")} className="reveal">
      <ul className="container mx-auto grid gap-5 px-4 pt-12 pb-10 sm:grid-cols-2">
        {TILES.map((tile) => (
          <li key={tile.gender}>
            <Link
              to={path("catalog", { gender: tile.gender })}
              className={cn(
                "tile-arrow flex min-h-50 items-end justify-between rounded-[1.75rem] p-8",
                tile.tile,
                // The ring sits outside the tile, on the white page.
                focusRing("onLight"),
              )}
            >
              <span className="text-4xl font-extrabold tracking-[-0.03em] md:text-5xl">
                {t(tile.label)}
              </span>
              <span data-arrow aria-hidden="true" className={cn("text-3xl", tile.arrow)}>
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
