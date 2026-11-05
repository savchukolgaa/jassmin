import { redirect } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireUser: vi.fn() }));
const profile = vi.hoisted(() => ({
  getProfile: vi.fn(),
  updateContact: vi.fn(),
  changeEmail: vi.fn(),
  changePassword: vi.fn(),
  notifyEmailChanged: vi.fn(),
}));

vi.mock("~/.server/services/auth", () => auth);
vi.mock("~/.server/services/profile", () => profile);
vi.mock("~/.server/locale", () => ({ getLocale: vi.fn(async () => "en") }));

type LoaderArgs = Parameters<typeof import("./account.profile").loader>[0];
type ActionArgs = Parameters<typeof import("./account.profile").action>[0];

const user = { id: 7, fullName: "Олена Коваль", email: "olena@example.com", role: "customer" };
const loginRedirect = () => redirect("/login?redirectTo=%2Faccount%2Fprofile");

function post(fields: Record<string, string>): ActionArgs {
  const request = new Request("http://localhost/account/profile", {
    method: "POST",
    body: new URLSearchParams(fields),
  });
  return { request, params: {}, context: {} } as unknown as ActionArgs;
}

async function act(fields: Record<string, string>) {
  const { action } = await import("./account.profile");
  const result = await action(post(fields));
  const { data, init } = result as unknown as { data: unknown; init?: { status?: number } };
  return { status: init?.status ?? 200, body: data };
}

const correctPassword = {
  currentPassword: "correct horse",
  newPassword: "brand new secret",
  confirmNewPassword: "brand new secret",
};

beforeEach(async () => {
  vi.clearAllMocks();
  auth.requireUser.mockResolvedValue(user);
  const { profilePasswordLimiter } = await import("~/.server/rate-limit");
  await profilePasswordLimiter.reset(String(user.id));
});

describe("account profile loader", () => {
  it("loads the logged-in user's profile", async () => {
    const details = {
      fullName: user.fullName,
      email: user.email,
      phone: null,
      createdAt: new Date(),
    };
    profile.getProfile.mockResolvedValueOnce(details);
    const { loader } = await import("./account.profile");

    const request = new Request("http://localhost/account/profile");
    expect(await loader({ request, params: {}, context: {} } as unknown as LoaderArgs)).toBe(
      details,
    );
    expect(profile.getProfile).toHaveBeenCalledWith(7);
  });

  it("redirects logged-out visitors to login", async () => {
    auth.requireUser.mockRejectedValueOnce(loginRedirect());
    const { loader } = await import("./account.profile");

    const request = new Request("http://localhost/account/profile");
    await expect(
      loader({ request, params: {}, context: {} } as unknown as LoaderArgs),
    ).rejects.toMatchObject({ status: 302 });
    expect(profile.getProfile).not.toHaveBeenCalled();
  });

  it("isn't indexed or cached", async () => {
    const { headers, meta } = await import("./account.profile");
    type MetaArgs = Parameters<typeof meta>[0];
    const matches = [{ id: "root", loaderData: { locale: "en" } }];

    expect(meta({ matches } as unknown as MetaArgs)).toEqual([
      { title: "Profile details — Jassmin" },
      { name: "robots", content: "noindex, follow" },
    ]);
    expect(headers()).toEqual({ "Cache-Control": "private, no-store" });
  });
});

describe("account profile action", () => {
  it("redirects logged-out visitors without changing anything", async () => {
    auth.requireUser.mockRejectedValueOnce(loginRedirect());
    const { action } = await import("./account.profile");

    await expect(action(post({ intent: "contact", fullName: "X" }))).rejects.toMatchObject({
      status: 302,
    });
    expect(profile.updateContact).not.toHaveBeenCalled();
  });

  it("rejects an unknown intent", async () => {
    expect(await act({ intent: "delete" })).toEqual({
      status: 400,
      body: { ok: false, intent: null, formError: "account.profile.errors.invalidIntent" },
    });
  });

  it("saves the contact details and clears a blank phone", async () => {
    expect(await act({ intent: "contact", fullName: " Олена Петренко ", phone: " " })).toEqual({
      status: 200,
      body: { ok: true, intent: "contact" },
    });
    expect(profile.updateContact).toHaveBeenCalledWith(7, {
      fullName: "Олена Петренко",
      phone: undefined,
    });
  });

  it("returns contact field errors with the typed values", async () => {
    expect(await act({ intent: "contact", fullName: "", phone: "call me" })).toEqual({
      status: 400,
      body: {
        ok: false,
        intent: "contact",
        fieldErrors: { fullName: "auth.errors.nameRequired", phone: "auth.errors.phoneInvalid" },
        values: { fullName: "", phone: "call me" },
      },
    });
    expect(profile.updateContact).not.toHaveBeenCalled();
  });

  it("changes the email and tells the old address", async () => {
    profile.changeEmail.mockResolvedValueOnce({ ok: true, previousEmail: "olena@example.com" });

    expect(
      await act({ intent: "email", email: " New@Example.com ", currentPassword: "correct horse" }),
    ).toEqual({ status: 200, body: { ok: true, intent: "email" } });
    expect(profile.changeEmail).toHaveBeenCalledWith(7, "correct horse", "new@example.com");
    expect(profile.notifyEmailChanged).toHaveBeenCalledWith({
      to: "olena@example.com",
      newEmail: "new@example.com",
      fullName: "Олена Коваль",
      locale: "en",
    });
  });

  it("sends no notice when the email didn't change", async () => {
    profile.changeEmail.mockResolvedValueOnce({ ok: true, previousEmail: null });

    await act({ intent: "email", email: "olena@example.com", currentPassword: "correct horse" });
    expect(profile.notifyEmailChanged).not.toHaveBeenCalled();
  });

  it("reports a wrong current password and a taken email next to the fields", async () => {
    profile.changeEmail.mockResolvedValueOnce({ ok: false, error: "wrong-password" });
    expect(
      await act({ intent: "email", email: "new@example.com", currentPassword: "nope" }),
    ).toEqual({
      status: 400,
      body: {
        ok: false,
        intent: "email",
        fieldErrors: { currentPassword: "account.profile.errors.currentPasswordWrong" },
        values: { email: "new@example.com" },
      },
    });

    profile.changeEmail.mockResolvedValueOnce({ ok: false, error: "email-taken" });
    const taken = await act({
      intent: "email",
      email: "taken@example.com",
      currentPassword: "correct horse",
    });
    expect(taken.body).toMatchObject({ fieldErrors: { email: "auth.errors.emailTaken" } });
    expect(profile.notifyEmailChanged).not.toHaveBeenCalled();
  });

  it("needs the current password before changing the email", async () => {
    const result = await act({ intent: "email", email: "new@example.com", currentPassword: "" });

    expect(result.body).toMatchObject({
      fieldErrors: { currentPassword: "account.profile.errors.currentPasswordRequired" },
    });
    expect(profile.changeEmail).not.toHaveBeenCalled();
  });

  it("changes the password without sending any password back", async () => {
    profile.changePassword.mockResolvedValueOnce({ ok: true });

    const result = await act({ intent: "password", ...correctPassword });

    expect(result).toEqual({ status: 200, body: { ok: true, intent: "password" } });
    expect(profile.changePassword).toHaveBeenCalledWith(7, "correct horse", "brand new secret");
    expect(JSON.stringify(result.body)).not.toContain("secret");
  });

  it("rejects a mismatched confirmation before checking the password", async () => {
    const result = await act({ intent: "password", ...correctPassword, confirmNewPassword: "x" });

    expect(result).toEqual({
      status: 400,
      body: {
        ok: false,
        intent: "password",
        fieldErrors: { confirmNewPassword: "account.profile.errors.passwordMismatch" },
      },
    });
    expect(profile.changePassword).not.toHaveBeenCalled();
  });

  it("blocks after five wrong current passwords across both forms", async () => {
    profile.changePassword.mockResolvedValue({ ok: false, error: "wrong-password" });
    profile.changeEmail.mockResolvedValue({ ok: false, error: "wrong-password" });

    for (let i = 0; i < 3; i++) {
      expect((await act({ intent: "password", ...correctPassword })).status).toBe(400);
    }
    for (let i = 0; i < 2; i++) {
      await act({ intent: "email", email: "new@example.com", currentPassword: "nope" });
    }
    vi.clearAllMocks();

    expect(await act({ intent: "password", ...correctPassword })).toEqual({
      status: 429,
      body: { ok: false, intent: "password", formError: "account.profile.errors.tooManyAttempts" },
    });
    const email = await act({ intent: "email", email: "new@example.com", currentPassword: "x" });
    expect(email.status).toBe(429);
    expect(profile.changePassword).not.toHaveBeenCalled();
    expect(profile.changeEmail).not.toHaveBeenCalled();
  });
});
