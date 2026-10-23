import { Link } from "react-router";
import { buttonClasses } from "~/components/ui/button-styles";

export interface PaginationProps {
  page: number;
  pageCount: number;
  /** Link to a page, keeping the list's other search params (e.g. catalog filters). */
  hrefForPage: (page: number) => string;
}

/** Previous / page numbers / Next links for a paginated list (catalog, blog). */
export function Pagination({ page, pageCount, hrefForPage }: PaginationProps) {
  if (pageCount <= 1) {
    return null;
  }
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1);

  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-center gap-2">
      {page > 1 && (
        <Link
          to={hrefForPage(page - 1)}
          rel="prev"
          className={buttonClasses({ variant: "ghost", size: "sm" })}
        >
          Previous
        </Link>
      )}
      {pages.map((target) => (
        <Link
          key={target}
          to={hrefForPage(target)}
          aria-current={target === page ? "page" : undefined}
          className={buttonClasses({
            variant: target === page ? "primary" : "ghost",
            size: "sm",
            className: "min-w-11 px-3",
          })}
        >
          {target}
        </Link>
      ))}
      {page < pageCount && (
        <Link
          to={hrefForPage(page + 1)}
          rel="next"
          className={buttonClasses({ variant: "ghost", size: "sm" })}
        >
          Next
        </Link>
      )}
    </nav>
  );
}
