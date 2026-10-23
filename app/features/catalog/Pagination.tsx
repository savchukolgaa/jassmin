import { Link } from "react-router";
import { buttonClasses } from "~/components/ui/button-styles";
import { type CatalogSearch, catalogHref } from "~/lib/catalog";

export interface PaginationProps {
  pathname: string;
  search: CatalogSearch;
  page: number;
  pageCount: number;
}

export function Pagination({ pathname, search, page, pageCount }: PaginationProps) {
  if (pageCount <= 1) {
    return null;
  }
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1);
  const link = (target: number) => catalogHref(pathname, search, target);

  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-center gap-2">
      {page > 1 && (
        <Link
          to={link(page - 1)}
          rel="prev"
          className={buttonClasses({ variant: "ghost", size: "sm" })}
        >
          Previous
        </Link>
      )}
      {pages.map((target) => (
        <Link
          key={target}
          to={link(target)}
          aria-current={target === page ? "page" : undefined}
          className={buttonClasses({
            variant: target === page ? "primary" : "secondary",
            size: "sm",
            className: "min-w-9 px-3",
          })}
        >
          {target}
        </Link>
      ))}
      {page < pageCount && (
        <Link
          to={link(page + 1)}
          rel="next"
          className={buttonClasses({ variant: "ghost", size: "sm" })}
        >
          Next
        </Link>
      )}
    </nav>
  );
}
