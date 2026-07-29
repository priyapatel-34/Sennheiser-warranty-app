import dotenv from "dotenv";
dotenv.config();

// @ts-check
import { join } from "path";
import { readFileSync } from "fs";
import express from "express";

import shopify from "./shopify.js";
import PrivacyWebhookHandlers from "./privacy.js";
import { OrderWebhookHandlers, registerOrderWebhooks } from "./orderWebhooks.js";

import { verifyAppProxy } from "./middleware/verifyAppProxy.js";
import warrantyRoutes from "./routes/warranty.routes.js";
import retailersRoutes from "./routes/retailers.routes.js";
import settingRoutes from "./routes/settings.routes.js";
import standardWarranty from "./routes/standardWarranty.routes.js";
import extendedWarranty from "./routes/extendedWarranty.routes.js";
import registeredProducts from "./routes/registeredProducts.routes.js";
import emailSettingsRoutes from "./routes/emailSettings.routes.js";

import { createStandardWarrantyMetafield } from "./shopify/metafieldDefinitions.js";
import { registerProductUpdateWebhook } from "./shopify/webhookCreation.js";

import { initDb } from "./db/initDb.js";
import { startExtendedWarrantyReminderScheduler } from "./services/extendedWarrantyReminder.service.js";

import { pool } from "./db/mysql.js";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = parseInt(
  process.env.BACKEND_PORT || process.env.PORT || "3000",
  10
);

const STATIC_PATH =
  process.env.NODE_ENV === "production"
    ? join(__dirname, "frontend", "dist")
    : join(__dirname, "frontend");
const PROJECT_ROOT = join(__dirname, "..");
const app = express();
app.set("trust proxy", 1);

// ── Auth routes ─────────────────────────────────────────────────────────────
app.get(shopify.config.auth.path, shopify.auth.begin());

app.get(
  shopify.config.auth.callbackPath,
  shopify.auth.callback(),
  // ── Custom post-auth handler ────────────────────────────────────────────
  // IMPORTANT: must accept `next` and call it — redirectToShopifyOrAppRoot()
  // is a separate middleware below. Returning the function without calling it
  // sends no HTTP response and causes a 524 timeout.
  async (req, res, next) => {
    const session = res.locals.shopify.session;

    if (!session) {
      console.error("❌ Auth callback: no session found");
      return res.status(500).send("No session found");
    }

    const t0 = Date.now();

    try {
      // Detect whether this is a first install or a periodic online-token refresh.
      // We check BEFORE the upsert so we can decide whether to run install-only tasks.
      const [[existingShop]] = await pool.query(
        `SELECT id, is_installed FROM shops WHERE shop_domain = ? LIMIT 1`,
        [session.shop]
      );
      const isFirstInstall = !existingShop || !existingShop.is_installed;

      // Always upsert the shop record to keep the access_token and scope current.
      await pool.query(
        `
        INSERT INTO shops
          (shop_domain, access_token, scope, is_installed, installed_at)
        VALUES (?, ?, ?, TRUE, NOW())
        ON DUPLICATE KEY UPDATE
          access_token = VALUES(access_token),
          scope        = VALUES(scope),
          is_installed = TRUE,
          uninstalled_at = NULL,
          updated_at   = NOW()
        `,
        [session.shop, session.accessToken, session.scope]
      );

      console.log(`✅ Auth callback: shop=${session.shop}, isFirstInstall=${isFirstInstall}, dbMs=${Date.now() - t0}`);

      if (isFirstInstall) {
        // Run all install-time Shopify setup in parallel — do NOT run on every
        // periodic token refresh (every 30-60 min), only on genuine first install
        // or reinstall after uninstall. Registering webhooks on every re-auth
        // accumulates duplicate subscriptions and adds 2-5 s of latency per auth.
        const admin = new shopify.api.clients.Graphql({ session });
        const setupT0 = Date.now();
        await Promise.all([
          createStandardWarrantyMetafield(admin),
          registerProductUpdateWebhook(admin),
          registerOrderWebhooks(admin),
        ]);
        console.log(`✅ Install-time setup complete in ${Date.now() - setupT0} ms`);
      }

      return next();
    } catch (err) {
      console.error(`❌ Auth callback error for ${session.shop}:`, err);
      // Still redirect — don't leave the browser hanging on a setup error.
      return next();
    }
  },
  // Redirect middleware must be registered as a separate handler in the chain,
  // NOT returned from inside the async handler above.
  shopify.redirectToShopifyOrAppRoot()
);

// ── Webhooks ──────────────────────────────────────────────────────────────
app.post(
  shopify.config.webhooks.path,
  shopify.processWebhooks({
    webhookHandlers: {
      ...PrivacyWebhookHandlers,
      ...OrderWebhookHandlers,
    },
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Database init (runs once at startup, blocks app.listen) ───────────────
const dbT0 = Date.now();
await initDb();
console.log(`✅ initDb completed in ${Date.now() - dbT0} ms`);

startExtendedWarrantyReminderScheduler();

// ── Authenticated admin API routes ────────────────────────────────────────
app.use("/app/retailers",          shopify.validateAuthenticatedSession(), retailersRoutes);
app.use("/app/settings",           shopify.validateAuthenticatedSession(), settingRoutes);
app.use("/app/standard-warranty",  shopify.validateAuthenticatedSession(), standardWarranty);
app.use("/app/extended-warranty",  shopify.validateAuthenticatedSession(), extendedWarranty);
app.use("/app/registered-products",shopify.validateAuthenticatedSession(), registeredProducts);
app.use("/app/email-settings",     shopify.validateAuthenticatedSession(), emailSettingsRoutes);

// ── App-proxy routes (storefront) ─────────────────────────────────────────
app.use("/tws-warranty/*", authenticateUser);

async function authenticateUser(req, res, next) {
  const { shop } = req.query;
  if (!shop) {
    return res.status(401).send("Missing shop");
  }

  if (!verifyAppProxy(req)) {
    return res.status(401).send("Invalid proxy signature");
  }

  const sessions = await shopify.config.sessionStorage.findSessionsByShop(shop);
  if (!sessions || !sessions.length) {
    return res.status(401).send("App not installed");
  }

  res.locals.shopifySession = sessions[0];
  next();
}

app.use("/tws-warranty", warrantyRoutes);

app.use("/api/*", shopify.validateAuthenticatedSession());
app.use(shopify.cspHeaders());

// ── Static assets ─────────────────────────────────────────────────────────
app.use("/assets", express.static(join(STATIC_PATH, "assets")));

// Google Search Console verification (public, no auth)
app.get("/googlea6475a09f81eb4bb.html", (_req, res) => {
  return res
    .status(200)
    .set("Content-Type", "text/html")
    .send(readFileSync(join(PROJECT_ROOT, "googlea6475a09f81eb4bb.html")));
});

// ── SPA catch-all (must be last) ──────────────────────────────────────────
app.use("/*", shopify.ensureInstalledOnShop(), async (_req, res) => {
  return res
    .status(200)
    .set("Content-Type", "text/html")
    .send(
      readFileSync(join(STATIC_PATH, "index.html"))
        .toString()
        .replace("%VITE_SHOPIFY_API_KEY%", process.env.SHOPIFY_API_KEY || "")
    );
});

app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
