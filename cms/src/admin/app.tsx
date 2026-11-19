import type { StrapiApp } from "@strapi/strapi/admin";
import { useFetchClient, useNotification } from "@strapi/strapi/admin";

/**
 * The newsletter's buttons in the edit view (#181): "Надіслати тест собі" emails the newsletter to
 * the signed-in admin only, and "Надіслати підписникам" sends it once to every customer who agreed
 * to news and offers. Both call the admin-only routes in `src/newsletter/send.ts`, which pass it
 * to the shop. Save the newsletter first: they send what is saved, not what is in the form.
 */

const NEWSLETTER_UID = "api::newsletter.newsletter";

/** What the content-manager passes a document action (the parts used here). */
interface ActionProps {
  model: string;
  documentId?: string;
  document?: { newsletterStatus?: unknown } | null;
}

interface ActionDescription {
  label: string;
  position?: "panel" | "header" | "table-row";
  variant?: "default" | "secondary" | "tertiary" | "danger" | "success";
  disabled?: boolean;
  onClick?: () => Promise<boolean | undefined> | boolean | undefined;
  dialog?: {
    type: "dialog";
    title: string;
    content?: string;
    confirmLabel?: string;
    onConfirm?: () => Promise<void>;
  };
}

type ActionComponent = (props: ActionProps) => ActionDescription | null;

/** The error message the route sent, or a fallback. */
function messageOf(error: unknown): string {
  const response =
    typeof error === "object" && error !== null && "response" in error
      ? (error as { response?: { data?: { error?: { message?: unknown } } } }).response
      : undefined;
  const message = response?.data?.error?.message;
  return typeof message === "string"
    ? message
    : "Не вдалося зв’язатися з магазином. Спробуйте пізніше.";
}

function useNewsletterRequest() {
  const { post } = useFetchClient();
  const { toggleNotification } = useNotification();
  return async (documentId: string, mode: "send" | "test"): Promise<boolean> => {
    try {
      const { data } = await post<{ message?: string }>(
        `/jassmin/newsletters/${encodeURIComponent(documentId)}/${mode}`,
        {},
      );
      toggleNotification({ type: "success", message: data.message ?? "Готово." });
      return true;
    } catch (error) {
      toggleNotification({ type: "danger", message: messageOf(error), timeout: 15_000 });
      return false;
    }
  };
}

const SendTestAction: ActionComponent = ({ model, documentId }) => {
  const request = useNewsletterRequest();
  if (model !== NEWSLETTER_UID) return null;
  return {
    label: "Надіслати тест собі",
    position: "panel",
    variant: "secondary",
    disabled: !documentId,
    onClick: async () => {
      if (documentId) await request(documentId, "test");
      return true;
    },
  };
};

const SendAction: ActionComponent = ({ model, documentId, document }) => {
  const request = useNewsletterRequest();
  if (model !== NEWSLETTER_UID) return null;
  const isDraft = (document?.newsletterStatus ?? "draft") === "draft";
  return {
    label: isDraft ? "Надіслати підписникам" : "Розсилку надіслано",
    position: "panel",
    variant: "default",
    disabled: !documentId || !isDraft,
    dialog: {
      type: "dialog",
      title: "Надіслати розсилку?",
      content:
        "Її отримає кожен клієнт, який погодився на новинки й пропозиції, — українською або англійською. " +
        "Надіслати можна лише раз, а наступну розсилку — не раніше ніж за тиждень. " +
        "Магазин надсилає листи частинами в межах денного ліміту, тож це може зайняти кілька днів. " +
        "Надсилається збережена версія: спершу збережіть зміни.",
      confirmLabel: "Надіслати",
      onConfirm: async () => {
        if (documentId && (await request(documentId, "send"))) {
          // Show the status and counts the shop answered with.
          window.setTimeout(() => window.location.reload(), 1500);
        }
      },
    },
  };
};

export default {
  config: {
    locales: [],
  },
  bootstrap(app: StrapiApp) {
    const contentManager = app.getPlugin("content-manager") as unknown as {
      apis: { addDocumentAction(reducer: (actions: ActionComponent[]) => ActionComponent[]): void };
    };
    contentManager.apis.addDocumentAction((actions) => [...actions, SendTestAction, SendAction]);
  },
};
