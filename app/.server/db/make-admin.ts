// `pnpm db:make-admin <email> [--revoke]`: gives a registered user the admin role, or takes it
// away. The CLI wrapper is scripts/make-admin.ts.
import { emailSchema } from "~/lib/auth.schema";
import type { UserRole } from "~/lib/enums";
import type { Db } from "./client";
import { setUserRole } from "./queries/users";

export const MAKE_ADMIN_USAGE = "Usage: pnpm db:make-admin <email> [--revoke]";

export type MakeAdminArgs =
  | { ok: true; email: string; role: UserRole }
  | { ok: false; error: string };

/** Parses the CLI arguments (without `node` and the script path). */
export function parseMakeAdminArgs(argv: readonly string[]): MakeAdminArgs {
  const revoke = argv.includes("--revoke");
  const rest = argv.filter((arg) => arg !== "--revoke" && arg !== "--");
  const [rawEmail, ...extra] = rest;
  if (rawEmail === undefined || extra.length > 0 || rawEmail.startsWith("-")) {
    return { ok: false, error: MAKE_ADMIN_USAGE };
  }

  const email = emailSchema.safeParse(rawEmail);
  if (!email.success) {
    return { ok: false, error: `Not a valid email address: ${rawEmail}` };
  }
  return { ok: true, email: email.data, role: revoke ? "customer" : "admin" };
}

/** Applies the parsed arguments; returns the message to print and whether it worked. */
export async function makeAdmin(
  db: Db,
  { email, role }: { email: string; role: UserRole },
): Promise<{ ok: boolean; message: string }> {
  if (!(await setUserRole(db, email, role))) {
    return {
      ok: false,
      message: `No user with the email ${email}. Register the account at /register first.`,
    };
  }
  return {
    ok: true,
    message:
      role === "admin" ? `${email} is now an admin.` : `${email} is no longer an admin (customer).`,
  };
}
