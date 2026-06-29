import shopify from "../shopify.js";
import { pool } from "../db/mysql.js";
import { sendEmailService } from "./email.service.js";
import ExtendedWarrantyEligibilityReminderTemplate from "../emailTemp/extended_warranty_eligibility_reminder.js";
import {
  evaluatePurchaseWindowEligibility,
  getReminderDaysForShop,
} from "./extendedWarranty.service.js";

function formatDisplayDate(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function buildMyProductsUrl(shopDomain) {
  return `https://${shopDomain}/pages/my-products`;
}

async function wasReminderSent(registeredProductId, reminderDays) {
  const [[row]] = await pool.query(
    `
    SELECT id
    FROM extended_warranty_eligibility_reminders
    WHERE registered_product_id = ? AND reminder_days = ?
    LIMIT 1
    `,
    [registeredProductId, reminderDays]
  );
  return Boolean(row);
}

async function recordReminderSent(shopId, registeredProductId, reminderDays) {
  await pool.query(
    `
    INSERT IGNORE INTO extended_warranty_eligibility_reminders (
      shop_id, registered_product_id, reminder_days
    ) VALUES (?, ?, ?)
    `,
    [shopId, registeredProductId, reminderDays]
  );
}

async function loadReminderCandidates() {
  const [rows] = await pool.query(
    `
    SELECT
      rp.*,
      s.shop_domain
    FROM registered_products rp
    INNER JOIN shops s ON s.id = rp.shop_id AND s.is_installed = TRUE
    INNER JOIN extended_warranty_settings ews ON ews.shop_id = rp.shop_id
      AND ews.extended_warranty_purchase_days IS NOT NULL
    LEFT JOIN extended_warranty_entitlements ew ON ew.registered_product_id = rp.id
      AND ew.status IN ('active', 'pending_payment')
    WHERE ew.id IS NULL
      AND rp.customer_email IS NOT NULL
      AND rp.customer_email != ''
    `
  );
  return rows;
}

async function getShopSession(shopDomain) {
  const sessions = await shopify.config.sessionStorage.findSessionsByShop(shopDomain);
  return sessions?.[0] || null;
}

async function sendReminderForRegistration(row, daysRemaining) {
  const shopId = row.shop_id;
  const window = await evaluatePurchaseWindowEligibility(shopId, row);
  if (!window.allowed || !window.configured || window.daysRemaining !== daysRemaining) {
    return { sent: false, skipped: true };
  }

  if (await wasReminderSent(row.id, daysRemaining)) {
    return { sent: false, skipped: true, duplicate: true };
  }

  const session = await getShopSession(row.shop_domain);
  let storeName = row.shop_domain?.split(".")[0] || "Sonova Team";

  if (session) {
    try {
      const admin = new shopify.api.clients.Graphql({ session });
      const shopResponse = await admin.request(`query { shop { name } }`);
      storeName = shopResponse.data?.shop?.name || storeName;
    } catch {
      // use fallback store name
    }
  }

  const referenceDate = row.created_at || row.warranty_start;
  const eligibilityEndDate = formatDisplayDate(
    addDays(referenceDate, window.extendedWarrantyPurchaseDays)
  );

  const html = ExtendedWarrantyEligibilityReminderTemplate({
    customerName: row.customer_name,
    productTitle: row.product_name,
    serialNumber: row.serial_number,
    daysRemaining,
    eligibilityEndDate,
    extendWarrantyUrl: buildMyProductsUrl(row.shop_domain),
    storeName,
  });

  const result = await sendEmailService({
    to: row.customer_email,
    subject: `Reminder: ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} left to extend your warranty`,
    html,
    from: process.env.DEFAULT_FROM_EMAIL,
  });

  if (result.success) {
    await recordReminderSent(shopId, row.id, daysRemaining);
    return { sent: true, testMode: result.testMode };
  }

  return { sent: false, error: result.error };
}

export async function sendExtendedWarrantyEligibilityReminders() {
  const candidates = await loadReminderCandidates();
  const summary = { checked: candidates.length, sent: 0, skipped: 0, errors: 0 };

  for (const row of candidates) {
    const reminderDays = await getReminderDaysForShop(row.shop_id);

    if (!reminderDays.length) {
      summary.skipped += 1;
      continue;
    }

    const window = await evaluatePurchaseWindowEligibility(row.shop_id, row);
    if (!window.allowed || !window.configured) {
      summary.skipped += 1;
      continue;
    }

    if (!reminderDays.includes(window.daysRemaining)) {
      summary.skipped += 1;
      continue;
    }

    try {
      const outcome = await sendReminderForRegistration(row, window.daysRemaining);
      if (outcome.sent) {
        summary.sent += 1;
        console.log(
          `📧 EW eligibility reminder (${window.daysRemaining}d) sent to ${row.customer_email} for registration ${row.id}`
        );
      } else if (outcome.error) {
        summary.errors += 1;
      } else {
        summary.skipped += 1;
      }
    } catch (err) {
      summary.errors += 1;
      console.error(
        `❌ EW reminder failed for registration ${row.id}:`,
        err.message
      );
    }
  }

  if (summary.sent > 0 || summary.errors > 0) {
    console.log("📬 EW eligibility reminder job:", summary);
  }

  return summary;
}

export function startExtendedWarrantyReminderScheduler() {
  if (process.env.EW_REMINDER_EMAILS_ENABLED === "false") {
    console.log("ℹ️ EW eligibility reminder emails disabled (EW_REMINDER_EMAILS_ENABLED=false)");
    return;
  }

  const intervalMs = Number(process.env.EW_REMINDER_JOB_INTERVAL_MS) || 6 * 60 * 60 * 1000;
  let running = false;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      await sendExtendedWarrantyEligibilityReminders();
    } catch (err) {
      console.error("❌ EW eligibility reminder scheduler error:", err);
    } finally {
      running = false;
    }
  };

  setTimeout(run, 60 * 1000);
  setInterval(run, intervalMs);
  console.log(
    `✅ EW eligibility reminder scheduler started (every ${Math.round(intervalMs / 3600000)}h)`
  );
}
