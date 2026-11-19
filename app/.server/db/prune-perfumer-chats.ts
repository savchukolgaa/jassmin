// `pnpm db:prune-perfumer-chats` (#180): deletes the AI perfumer's saved chats not updated for
// `PERFUMER_CHAT_RETENTION_DAYS` (default 90), with their messages. That includes chats the
// customer closed ("New chat") or deleted ("Delete chat"): those are hidden at once and erased
// here. Run it daily from an external scheduler; the CLI wrapper is scripts/prune-perfumer-chats.ts.
import { z } from "zod";
import type { Db } from "./client";
import { deleteThreadsUpdatedBefore } from "./queries/perfumer-chats";

export const DEFAULT_PERFUMER_CHAT_RETENTION_DAYS = 90;

const daysSchema = z.coerce.number().int().positive().default(DEFAULT_PERFUMER_CHAT_RETENTION_DAYS);

/** Reads `PERFUMER_CHAT_RETENTION_DAYS` (default 90); an empty value counts as unset. */
export function parsePerfumerChatRetentionDays(
  source: NodeJS.ProcessEnv,
): { ok: true; days: number } | { ok: false; error: string } {
  const result = daysSchema.safeParse(source.PERFUMER_CHAT_RETENTION_DAYS || undefined);
  if (!result.success) {
    return {
      ok: false,
      error: `PERFUMER_CHAT_RETENTION_DAYS must be a positive whole number of days, got "${source.PERFUMER_CHAT_RETENTION_DAYS}".`,
    };
  }
  return { ok: true, days: result.data };
}

/** Runs the job; returns how many chats it deleted and the message to log. */
export async function prunePerfumerChatsJob(
  db: Db,
  { days, now = new Date() }: { days: number; now?: Date },
): Promise<{ deleted: number; message: string }> {
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const deleted = await deleteThreadsUpdatedBefore(db, cutoff);
  const chats = deleted === 1 ? "perfumer chat" : "perfumer chats";
  return { deleted, message: `Deleted ${deleted} ${chats} not updated for ${days} days.` };
}
