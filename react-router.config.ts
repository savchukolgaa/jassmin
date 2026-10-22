import type { Config } from "@react-router/dev/config";

export default {
  // Full-stack SSR: data is loaded in route loaders and mutated in route actions.
  ssr: true,
} satisfies Config;
