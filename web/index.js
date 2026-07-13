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

// Set up Shopify authentication and webhook handling
app.get(shopify.config.auth.path, shopify.auth.begin());
app.get(
  shopify.config.auth.callbackPath,
  shopify.auth.callback(),
  async (req, res) => {
    const session = res.locals.shopify.session;

    if (!session) {
      return res.status(500).send("No session found");
    }

    // ✅ STORE SHOP IN MYSQL
    await pool.query(
      `
      INSERT INTO shops
        (shop_domain, access_token, scope, is_installed, installed_at)
      VALUES (?, ?, ?, TRUE, NOW())
      ON DUPLICATE KEY UPDATE
        access_token = VALUES(access_token),
        scope = VALUES(scope),
        is_installed = TRUE,
        uninstalled_at = NULL,
        updated_at = NOW()
      `,
      [
        session.shop,
        session.accessToken,
        session.scope,
      ]
    );

    console.log("✅ App installed for:", session.shop);



    const admin = new shopify.api.clients.Graphql({ session });


    // ✅ CREATE METAFIELD DEFINITION ON INSTALL
    await createStandardWarrantyMetafield(admin);

    await registerProductUpdateWebhook(admin);

    await registerOrderWebhooks(admin);

    // ✅ redirect AFTER DB write
    return shopify.redirectToShopifyOrAppRoot();
  }
);
app.post(
  shopify.config.webhooks.path,
  shopify.processWebhooks({
    webhookHandlers: {
      ...PrivacyWebhookHandlers,
      ...OrderWebhookHandlers,
    },
  })
);

// If you are adding routes outside of the /api path, remember to
// also add a proxy rule for them in web/frontend/vite.config.js

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

await initDb();
startExtendedWarrantyReminderScheduler();

app.use("/app/retailers", shopify.validateAuthenticatedSession(), retailersRoutes);

app.use("/app/settings", shopify.validateAuthenticatedSession(), settingRoutes);

app.use("/app/standard-warranty", shopify.validateAuthenticatedSession(), standardWarranty);

app.use("/app/extended-warranty", shopify.validateAuthenticatedSession(), extendedWarranty);

app.use("/app/registered-products", shopify.validateAuthenticatedSession(), registeredProducts);

app.use("/app/email-settings", shopify.validateAuthenticatedSession(), emailSettingsRoutes);

app.use("/tws-warranty/*", authenticateUser);

async function authenticateUser(req, res, next) {

  const { shop } = req.query;
  if (!shop) {
    return res.status(401).send("Missing shop");
  }

  // ✅ Verify app proxy signature
  if (!verifyAppProxy(req)) {
    return res.status(401).send("Invalid proxy signature");
  }

  const sessions =
    await shopify.config.sessionStorage.findSessionsByShop(shop);

  if (!sessions || !sessions.length) {
    return res.status(401).send("App not installed");
  }

  // Attach session for reuse
  res.locals.shopifySession = sessions[0];

  next();
}

app.use("/tws-warranty", warrantyRoutes);

app.use("/api/*", shopify.validateAuthenticatedSession());

app.use(shopify.cspHeaders());
// Serve only static assets folder
app.use("/assets", express.static(join(STATIC_PATH, "assets")));

// Google Search Console verification (public, no auth)
app.get("/googlea6475a09f81eb4bb.html", (_req, res) => {
  return res
    .status(200)
    .set("Content-Type", "text/html")
    .send(readFileSync(join(PROJECT_ROOT, "googlea6475a09f81eb4bb.html")));
});

// Final catch-all must be AFTER everything
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

app.listen(PORT);
