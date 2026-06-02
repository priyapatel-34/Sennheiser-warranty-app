import { pool } from "../db/mysql.js";
import shopify from "../shopify.js";

export async function getProductUpdateWebhook(req, res){
    try {
      // 1️⃣ Verify webhook
      const verified = shopify.webhooks.validate({
        rawBody: req.body,
        rawRequest: req,
        rawResponse: res,
      });

      if (!verified) {
        return res.status(401).send("Invalid webhook");
      }

      // 2️⃣ Parse payload
      const payload = JSON.parse(req.body.toString());
      const productGid = `gid://shopify/Product/${payload.id}`;
      const productId = Number(payload.id);
      const shopDomain = req.headers["x-shopify-shop-domain"];

      // 3️⃣ Find warranty metafield
      const warrantyMetafield = payload.metafields?.find(
        mf =>
          mf.namespace === "warranty" &&
          mf.key === "standard_duration"
      );

      if (!warrantyMetafield) {
        // merchant removed warranty → delete from DB
        await pool.query(
          `
          DELETE psw FROM product_standard_warranty_durations psw
          JOIN shops s ON psw.shop_id = s.id
          WHERE s.shop_domain = ? AND psw.product_id = ?
          `,
          [shopDomain, productId]
        );

        return res.status(200).send("No warranty metafield");
      }

      const duration = Number(warrantyMetafield.value);

      // 4️⃣ Get shop_id
      const [[shopRow]] = await pool.query(
        `SELECT id FROM shops WHERE shop_domain = ?`,
        [shopDomain]
      );

      if (!shopRow) {
        return res.status(404).send("Shop not found");
      }

      const shopId = shopRow.id;

    //   // 5️⃣ Calculate expiry
    //   const expiresAt = new Date();
    //   expiresAt.setFullYear(expiresAt.getFullYear() + duration);
    //   const expiresAtSQL = expiresAt.toISOString().split("T")[0];

      // 6️⃣ Upsert DB
      await pool.query(
        `
        INSERT INTO product_standard_warranty
          (shop_id, product_id, duration_years)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE
          duration_years = VALUES(duration_years),
          expires_at = VALUES(expires_at)
        `,
        [shopId, productId, duration]
      );

      console.log(
        `🔄 Synced warranty for product ${productId}: ${duration} years`
      );

      res.status(200).send("OK");

    } catch (err) {
      console.error("❌ Product update webhook error:", err);
      res.status(500).send("Webhook error");
    }
}

