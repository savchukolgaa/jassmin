import { createCookieSessionStorage } from "react-router";
import { getEnv } from "./env";

export interface SessionData {
  /** Set on login (#9). */
  userId?: number;
}

export interface SessionFlashData {
  error?: string;
}

const env = getEnv();

export const { getSession, commitSession, destroySession } = createCookieSessionStorage<
  SessionData,
  SessionFlashData
>({
  cookie: {
    name: "__jassmin_session",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: env.NODE_ENV === "production",
    secrets: [env.SESSION_SECRET],
    maxAge: 60 * 60 * 24 * 30,
  },
});
