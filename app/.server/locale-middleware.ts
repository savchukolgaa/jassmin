// The root middleware (#84): a visitor who chose English with the switcher (the `locale` cookie)
// and opens a Ukrainian page is sent to the same page in English. `Accept-Language` alone never
// redirects, so crawlers and first-time visitors reach both versions. Client-side navigations
// (`/koshyk.data`) are matched by their page URL, so they're redirected too (#112).
import { type MiddlewareFunction, redirect } from "react-router";
import { matchPage } from "~/lib/paths";
import { getChosenLocale } from "./locale";
import { localizedUrl } from "./paths";
import { pageUrl } from "./request-url";

export const localeRedirectMiddleware: MiddlewareFunction<Response> = async ({ request }, next) => {
  if (request.method === "GET" || request.method === "HEAD") {
    const url = pageUrl(request);
    const page = matchPage(url.pathname);
    if (page?.locale === "uk" && (await getChosenLocale(request)) === "en") {
      throw redirect(await localizedUrl(url.pathname + url.search, "en"), 302);
    }
  }
  return next();
};
