import { useRouteLoaderData } from "react-router";
import type { loader as shopLoader } from "~/routes/_shop";

/**
 * Whether the AI perfumer chat exists (`AI_BASE_URL` is set), from the shop layout's loader (#163).
 * Every entry point to the chat hides itself when it doesn't (#165).
 */
export function usePerfumerEnabled(): boolean {
  return useRouteLoaderData<typeof shopLoader>("routes/_shop")?.perfumerEnabled === true;
}
