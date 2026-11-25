// Production resources for `pnpm aspire publish` / `pnpm aspire:deploy` (#176): one Hetzner server
// running Docker Compose. Run mode (`pnpm aspire run`) never declares any of this; see apphost.mts.
//
// Services: `postgres` (jassmindb + strapidb on a named volume), `db-migrate` (runs once per
// deploy, `web` waits for it), `web`, `cms` (Strapi, uploads on a named volume), `scheduler`
// (supercronic running deploy/crontab), `pg-backup` (nightly dumps into /srv/jassmin/backups) and
// `proxy` (Caddy with automatic HTTPS, the only service with host ports). The site, Strapi and the
// jobs images are pushed to GHCR; the server pulls them. `deploy-ssh` copies the generated
// docker-compose.yaml and .env to the server and runs `docker compose up -d` there over SSH;
// run it all with `pnpm aspire:deploy`.
// Secrets are Aspire parameters (asked for or generated on the first deploy), never committed.
// See docs/deploy.md.

import { spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  ContainerResource,
  DistributedApplicationBuilder,
  ParameterResource,
  PipelineStepContext,
} from "./.aspire/modules/aspire.mjs";
import { EndpointProperty, refExpr } from "./.aspire/modules/aspire.mjs";

/** Where the Compose files live on the server. */
const REMOTE_DIR = "/srv/jassmin";

/** Where Aspire writes docker-compose.yaml and .env: `pnpm aspire:deploy` passes `-o aspire-output`. */
const OUTPUT_DIR = resolve(import.meta.dirname, "..", "aspire-output");

/**
 * The .env with the values, written by `prepare-jassmin` for the deploy environment (`aspire do`
 * defaults to Production). `publish` writes only `.env`, an empty template.
 */
const ENV_FILE = ".env.Production";

/** A random secret, generated on the first deploy and kept in Aspire's deployment state. */
function generatedSecret(builder: DistributedApplicationBuilder, name: string, minLength = 48) {
  return builder.addParameterWithGeneratedValue(
    name,
    { minLength, special: false },
    { secret: true, persist: true },
  );
}

/** Restart after a crash or a server reboot, as long as nobody stopped the service by hand. */
async function restartUnlessStopped(resource: ContainerResource): Promise<void> {
  await resource.publishAsDockerComposeService(async (_service, compose) => {
    await compose.restart.set("unless-stopped");
  });
}

export async function addProductionResources(builder: DistributedApplicationBuilder) {
  await builder.addDockerComposeEnvironment("jassmin").withDashboard({ enabled: false });

  // Settings the owner enters on the first deploy (docs/deploy.md → First deploy).
  const siteDomain = await builder
    .addParameter("site-domain")
    .withDescription("The shop's domain, without https:// (e.g. example.ua).");
  const adminDomain = await builder
    .addParameter("admin-domain")
    .withDescription("Strapi admin's domain (e.g. admin.example.ua).");
  const ghcrRepository = await builder
    .addParameter("ghcr-repository")
    .withDescription("GHCR namespace for the images, e.g. <github-user>/jassmin.");
  const smtpUrl = await builder.addParameter("smtp-url", { secret: true });
  const emailWebhookSecret = await builder.addParameter("email-webhook-secret", { secret: true });
  // Created in the Strapi admin after the first deploy; enter `pending` until then (docs/deploy.md).
  const strapiApiToken = await builder.addParameter("strapi-api-token", { secret: true });
  const strapiSyncToken = await builder.addParameter("strapi-sync-token", { secret: true });
  // Card payments (#192, docs/payments.md). The LiqPay keys are `pending` until LiqPay approves the
  // shop. `payment-provider` is the go-live switch: `none` (card payment off) until it's set to
  // `liqpay` in the deployment state; a pipeline can't read a parameter, so it goes straight into
  // PAYMENT_PROVIDER, where env.ts reads `none` as unset.
  const liqpayPublicKey = await builder.addParameter("liqpay-public-key", { secret: true });
  const liqpayPrivateKey = await builder.addParameter("liqpay-private-key", { secret: true });
  const paymentProvider = await builder
    .addParameter("payment-provider", { value: "none" })
    .withDescription("Card payments: none (off) or liqpay, once LiqPay has approved the shop.");

  // Random secrets nobody types. Losing Aspire's deployment state would change them, so
  // docs/deploy.md has the owner back it up.
  const postgresPassword = await generatedSecret(builder, "postgres-password", 32);
  const sessionSecret = await generatedSecret(builder, "session-secret");
  const cmsSyncSecret = await generatedSecret(builder, "cms-sync-secret");
  const emailUnsubscribeSecret = await generatedSecret(builder, "email-unsubscribe-secret");
  const strapiSecrets: [string, ParameterResource][] = [
    ["APP_KEYS", await generatedSecret(builder, "strapi-app-keys")],
    ["API_TOKEN_SALT", await generatedSecret(builder, "strapi-api-token-salt")],
    ["ADMIN_JWT_SECRET", await generatedSecret(builder, "strapi-admin-jwt-secret")],
    ["TRANSFER_TOKEN_SALT", await generatedSecret(builder, "strapi-transfer-token-salt")],
    ["JWT_SECRET", await generatedSecret(builder, "strapi-jwt-secret")],
    ["ENCRYPTION_KEY", await generatedSecret(builder, "strapi-encryption-key")],
  ];

  // Aspire wants the endpoint as a parameter when the repository is one; it defaults to GHCR.
  const registryEndpoint = await builder.addParameter("registry-endpoint", {
    value: "ghcr.io",
    publishValueAsDefault: true,
  });
  const ghcr = await builder.addContainerRegistry("ghcr", registryEndpoint, {
    repository: ghcrRepository,
  });

  const postgres = await builder
    .addPostgres("postgres", { password: postgresPassword })
    .withImageTag("18")
    .withDataVolume({ name: "jassmin-postgres-data" });
  await restartUnlessStopped(postgres);
  const db = await postgres.addDatabase("jassmindb");
  const strapiDb = await postgres.addDatabase("strapidb");

  // Once per deploy, from the `jobs` image: create the databases (Compose's Postgres starts empty,
  // and Aspire creates them only in run mode), then `pnpm db:migrate`. `cms`, `web` and `scheduler`
  // wait for it; it retries while Postgres starts, since Compose can't wait for its health here.
  const dbMigrate = await builder
    .addDockerfile("db-migrate", "..", { stage: "jobs" })
    .withArgs([
      "sh",
      "-c",
      "pnpm --silent db:create-databases jassmindb strapidb && pnpm --silent db:migrate",
    ])
    .withReference(db)
    .waitFor(postgres)
    .withContainerRegistry(ghcr);

  const cms = await builder
    .addDockerfile("cms", "..", { dockerfilePath: "cms/Dockerfile" })
    .withHttpEndpoint({ targetPort: 1337 })
    .withVolume("/app/cms/public/uploads", { name: "jassmin-strapi-uploads" })
    .withEnvironment("DATABASE_CLIENT", "postgres")
    .withEnvironment("DATABASE_URL", await strapiDb.uriExpression())
    .withEnvironment("PUBLIC_URL", refExpr`https://${adminDomain}`)
    .withEnvironment("IS_PROXIED", "true")
    .withEnvironment("CMS_SYNC_SECRET", cmsSyncSecret)
    .waitForCompletion(dbMigrate)
    .withContainerRegistry(ghcr);
  for (const [name, value] of strapiSecrets) {
    await cms.withEnvironment(name, value);
  }
  await restartUnlessStopped(cms);

  const web = await builder
    .addDockerfile("web", "..", { stage: "web" })
    .withHttpEndpoint({ targetPort: 3000 })
    .waitForCompletion(dbMigrate)
    .withContainerRegistry(ghcr);
  const scheduler = await builder
    .addDockerfile("scheduler", "..", { stage: "jobs" })
    .waitForCompletion(dbMigrate)
    .withContainerRegistry(ghcr);

  // The app's environment, shared by the site and the jobs. Card payment is LiqPay, live (never
  // its sandbox) once `payment-provider` says so. No AI_* variables: the AI perfumer stays off
  // until #167.
  for (const app of [web, scheduler]) {
    await app
      .withReference(db)
      .withEnvironment("NODE_ENV", "production")
      .withEnvironment("SESSION_SECRET", sessionSecret)
      .withEnvironment("PUBLIC_SITE_URL", refExpr`https://${siteDomain}`)
      .withEnvironment("TRUSTED_PROXY_HOPS", "1")
      // Strapi stays internal: browsers get its images through the app's /uploads/* proxy.
      .withEnvironment("STRAPI_URL", cms.getEndpoint("http"))
      .withEnvironment("STRAPI_API_TOKEN", strapiApiToken)
      .withEnvironment("STRAPI_SYNC_TOKEN", strapiSyncToken)
      .withEnvironment("CMS_SYNC_SECRET", cmsSyncSecret)
      .withEnvironment("SMTP_URL", smtpUrl)
      .withEnvironment("EMAIL_WEBHOOK_SECRET", emailWebhookSecret)
      .withEnvironment("EMAIL_UNSUBSCRIBE_SECRET", emailUnsubscribeSecret)
      .withEnvironment("PAYMENT_PROVIDER", paymentProvider)
      .withEnvironment("LIQPAY_PUBLIC_KEY", liqpayPublicKey)
      .withEnvironment("LIQPAY_PRIVATE_KEY", liqpayPrivateKey)
      .withEnvironment("LIQPAY_SANDBOX", "false")
      // Newsletter emails per 24 hours (#181): Brevo's free 300 a day, less room for order,
      // account and cart reminder emails. Raise it with a paid plan (docs/email.md).
      .withEnvironment("NEWSLETTER_DAILY_LIMIT", "200");
    await restartUnlessStopped(app);
  }
  // Strapi writes product and order edits through to the app (#40).
  await cms.withEnvironment("JASSMIN_APP_URL", web.getEndpoint("http"));

  // Nightly pg_dump of both databases, kept 7 days in /srv/jassmin/backups on the host.
  const pgBackup = await builder
    .addDockerfile("pg-backup", "../deploy/pg-backup")
    .withBindMount(`${REMOTE_DIR}/backups`, "/backups")
    .withEnvironment("PGHOST", postgres.getEndpoint("tcp").property(EndpointProperty.Host))
    .withEnvironment("PGUSER", "postgres")
    .withEnvironment("PGPASSWORD", postgresPassword)
    .withEnvironment("BACKUP_DATABASES", "jassmindb strapidb")
    .waitFor(postgres)
    .withContainerRegistry(ghcr);
  await restartUnlessStopped(pgBackup);

  // Caddy: HTTPS for both domains, the only service published on the host (80 and 443).
  const proxy = await builder
    .addDockerfile("proxy", "../deploy/caddy")
    .withEndpoint({ name: "http", port: 80, targetPort: 80, scheme: "http" })
    .withEndpoint({ name: "https", port: 443, targetPort: 443, scheme: "https" })
    .withExternalHttpEndpoints()
    .withVolume("/data", { name: "jassmin-caddy-data" })
    .withVolume("/config", { name: "jassmin-caddy-config" })
    .withEnvironment("SITE_DOMAIN", siteDomain)
    .withEnvironment("ADMIN_DOMAIN", adminDomain)
    .withContainerRegistry(ghcr);
  await restartUnlessStopped(proxy);

  // Run with `pnpm aspire:deploy` (`aspire do deploy-ssh`), not `aspire deploy`: the latter also
  // runs Aspire's own `docker-compose-up-jassmin`, which would start the stack on this computer.
  // `prepare-jassmin` builds the images and writes the .env with the values; `push` pushes them.
  await builder.pipeline().addStep("deploy-ssh", deployOverSsh, {
    dependsOn: ["push", "prepare-jassmin"],
  });
}

/**
 * Runs a command without a shell, streaming its output, and fails on a non-zero exit. `stdinFile`
 * is piped to its standard input.
 */
function run(command: string, args: string[], stdinFile?: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: [stdinFile ? "pipe" : "inherit", "inherit", "inherit"],
    });
    if (stdinFile && child.stdin) {
      createReadStream(stdinFile).on("error", reject).pipe(child.stdin);
    }
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolvePromise()
        : reject(new Error(`${command} ${args.join(" ")} exited with ${code}`)),
    );
  });
}

/**
 * Copies the generated Compose files to the server and starts them there. The server is
 * `DEPLOY_SSH_TARGET` (e.g. `deploy@203.0.113.7`) from the environment of `pnpm aspire:deploy`.
 */
async function deployOverSsh(context: PipelineStepContext): Promise<void> {
  const target = process.env.DEPLOY_SSH_TARGET;
  if (!target) {
    throw new Error(
      "Set DEPLOY_SSH_TARGET (e.g. deploy@203.0.113.7) before `pnpm aspire:deploy`; see docs/deploy.md.",
    );
  }
  const composeFile = join(OUTPUT_DIR, "docker-compose.yaml");
  const envFile = join(OUTPUT_DIR, ENV_FILE);
  const missing = [composeFile, envFile].filter((file) => !existsSync(file));
  if (missing.length > 0) {
    throw new Error(`Aspire didn't write ${missing.join(", ")}; run \`pnpm aspire:deploy\`.`);
  }

  const step = await context.reportingStep();
  const copy = await step.createTask(`Copying the Compose files to ${target}:${REMOTE_DIR}`);
  await run("scp", ["-q", composeFile, `${target}:${REMOTE_DIR}/docker-compose.yaml`]);
  // The secrets go through stdin into a file only the deploy user can read, from its first byte.
  await run("ssh", [target, `umask 077 && cat > ${REMOTE_DIR}/.env`], envFile);
  await copy.completeTask();

  const up = await step.createTask("Pulling the images and starting the services");
  await run("ssh", [
    target,
    `cd ${REMOTE_DIR} && docker compose pull --quiet && docker compose up -d --remove-orphans && docker image prune -f`,
  ]);
  await up.completeTask();
  await step.completeStep(`Deployed to ${target}`);
}
