import { pool } from "../db/mysql.js";
import {
  getEmailSettingsForShop,
  saveEmailSettingsForShop,
  previewEmailTemplate,
} from "../services/emailSettings.service.js";

/**
 * Resolves the installed shop record for the authenticated session so email
 * settings can be loaded against the correct merchant account.
 */
async function resolveShopId(session) {
  const [[shopRow]] = await pool.query(
    `SELECT id FROM shops WHERE shop_domain = ? AND is_installed = TRUE`,
    [session.shop]
  );
  return shopRow?.id || null;
}

/**
 * Returns the current email notification settings for the authenticated shop.
 */
export async function getEmailSettings(req, res) {
  try {
    const session = res.locals.shopify?.session;
    if (!session?.shop) return res.status(401).json({ error: "Unauthorized" });

    const shopId = await resolveShopId(session);
    if (!shopId) return res.status(404).json({ error: "Shop not registered" });

    const settings = await getEmailSettingsForShop(shopId);
    res.json(settings);
  } catch (err) {
    console.error("getEmailSettings error:", err);
    res.status(500).json({ error: "Failed to load email settings" });
  }
}

/**
 * Persists the current email notification settings for the authenticated shop.
 */
export async function saveEmailSettings(req, res) {
  try {
    const session = res.locals.shopify?.session;
    if (!session?.shop) return res.status(401).json({ error: "Unauthorized" });

    const shopId = await resolveShopId(session);
    if (!shopId) return res.status(404).json({ error: "Shop not registered" });

    const settings = await saveEmailSettingsForShop(shopId, req.body || {});
    res.json(settings);
  } catch (err) {
    console.error("saveEmailSettings error:", err);
    res.status(400).json({ error: err.message || "Failed to save email settings" });
  }
}

/**
 * Generates a preview of a template using sample storefront data without
 * sending an actual email.
 */
export async function previewEmailSettings(req, res) {
  try {
    const session = res.locals.shopify?.session;
    if (!session?.shop) return res.status(401).json({ error: "Unauthorized" });

    const { templateKey, subject, bodyHtml } = req.body || {};
    if (!templateKey) {
      return res.status(400).json({ error: "templateKey is required" });
    }

    const preview = previewEmailTemplate(templateKey, {
      subject,
      bodyHtml,
      sampleData: { shopDomain: session.shop },
    });
    res.json(preview);
  } catch (err) {
    console.error("previewEmailSettings error:", err);
    res.status(400).json({ error: err.message || "Failed to preview email" });
  }
}


// import { pool } from "../db/mysql.js";
// import {
//   getEmailSettingsForShop,
//   saveEmailSettingsForShop,
//   previewEmailTemplate,
// } from "../services/emailSettings.service.js";

// async function resolveShopId(session) {
//   const [[shopRow]] = await pool.query(
//     `SELECT id FROM shops WHERE shop_domain = ? AND is_installed = TRUE`,
//     [session.shop]
//   );
//   return shopRow?.id || null;
// }

// export async function getEmailSettings(req, res) {
//   try {
//     const session = res.locals.shopify?.session;
//     if (!session?.shop) return res.status(401).json({ error: "Unauthorized" });

//     const shopId = await resolveShopId(session);
//     if (!shopId) return res.status(404).json({ error: "Shop not registered" });

//     const settings = await getEmailSettingsForShop(shopId);
//     res.json(settings);
//   } catch (err) {
//     console.error("getEmailSettings error:", err);
//     res.status(500).json({ error: "Failed to load email settings" });
//   }
// }

// export async function saveEmailSettings(req, res) {
//   try {
//     const session = res.locals.shopify?.session;
//     if (!session?.shop) return res.status(401).json({ error: "Unauthorized" });

//     const shopId = await resolveShopId(session);
//     if (!shopId) return res.status(404).json({ error: "Shop not registered" });

//     const settings = await saveEmailSettingsForShop(shopId, req.body || {});
//     res.json(settings);
//   } catch (err) {
//     console.error("saveEmailSettings error:", err);
//     res.status(400).json({ error: err.message || "Failed to save email settings" });
//   }
// }

// export async function previewEmailSettings(req, res) {
//   try {
//     const session = res.locals.shopify?.session;
//     if (!session?.shop) return res.status(401).json({ error: "Unauthorized" });

//     const shopId = await resolveShopId(session);

//     const { templateKey, additionalNotes } = req.body || {};
//     if (!templateKey) {
//       return res.status(400).json({ error: "templateKey is required" });
//     }

//     const preview = await previewEmailTemplate(templateKey, {
//       shopId,
//       additionalNotes,
//     });
//     res.json(preview);
//   } catch (err) {
//     console.error("previewEmailSettings error:", err);
//     res.status(400).json({ error: err.message || "Failed to preview email" });
//   }
// }
