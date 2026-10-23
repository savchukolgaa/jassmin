// UI translations (#28): Ukrainian (default) and English. Copy lives in `uk.ts` and `en.ts`;
// components read it with `useT()`, route `meta` with `metaTranslator(matches)` and server code
// with `createTranslator(await getLocale(request))`.
export * from "./locales";
export * from "./react";
export * from "./translator";
export type * from "./types";
