import { usePerfumerThread } from "./usePerfumerThread";

/** The AI perfumer chat page (#163). */
export function PerfumerPage() {
  const thread = usePerfumerThread();
  return <main id="main" data-items={thread.items.length} />;
}
