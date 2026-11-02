// Vitest setup (`vitest.config.ts`): components rendered in tests get their messages from both
// dictionaries, so they render in Ukrainian without a provider and in English under
// `<I18nProvider locale="en">`. The app passes the root loader's messages instead (#96).
import { createTranslator } from "./dictionaries";
import { setFallbackTranslator } from "./react";

setFallbackTranslator(createTranslator);
