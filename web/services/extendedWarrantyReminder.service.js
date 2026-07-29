import shopify from "../shopify.js";
import { pool } from "../db/mysql.js";
import { sendShopEmail } from "./emailSettings.service.js";
import ExtendedWarrantyEligibilityReminderTemplate from "../emailTemp/extended_warranty_eligibility_reminder.js";
import {
  renderViewProductDetailsButton,
  buildMyProductsLoginUrl,
} from "./emailLink.service.js";
import {
  evaluatePurchaseWindowFromSettings,
  getExtendedWarrantySettings,
  getReminderDaysForShop,
  isExtendedWarrantyOfferEnabled,
} from "./extendedWarranty.service.js";

function formatDisplayDate(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}


function normalizeReminderDays(reminderDays) {
  return [
    ...new Set(
      (reminderDays || [])
        .map(value => Number(value))
        .filter(value => Number.isInteger(value) && value > 0)
    ),
  ];
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
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
      s.shop_domain,
      ews.extended_warranty_purchase_days
    FROM registered_products rp
    INNER JOIN shops s ON s.id = rp.shop_id AND s.is_installed = TRUE
    INNER JOIN extended_warranty_settings ews ON ews.shop_id = rp.shop_id
      AND ews.extended_warranty_purchase_days IS NOT NULL
      AND ews.extended_warranty_purchase_days > 0
    LEFT JOIN extended_warranty_entitlements ew ON ew.registered_product_id = rp.id
      AND ew.status IN ('active', 'pending_payment')
    WHERE ew.id IS NULL
      AND rp.customer_email IS NOT NULL
      AND TRIM(rp.customer_email) != ''
      AND DATE(rp.created_at) >= DATE_SUB(
        UTC_DATE(),
        INTERVAL (ews.extended_warranty_purchase_days - 1) DAY
      )
    `
  );
  return rows;
}

async function getShopSession(shopDomain) {
  const sessions = await shopify.config.sessionStorage.findSessionsByShop(shopDomain);
  return sessions?.[0] || null;
}

async function sendReminderForRegistration(row, purchaseWindow) {
  const shopId = row.shop_id;
  const daysRemaining = Number(purchaseWindow?.daysRemaining);

  if (
    !purchaseWindow?.allowed ||
    !purchaseWindow?.configured ||
    !Number.isInteger(daysRemaining) ||
    daysRemaining <= 0
  ) {
    return { sent: false, skipped: true, reason: "purchase_window_not_eligible" };
  }

  if (!isValidEmail(row.customer_email)) {
    return {
      sent: false,
      skipped: true,
      reason: "invalid_customer_email",
    };
  }

  if (!process.env.DEFAULT_FROM_EMAIL && !process.env.SENDGRID_FROM_EMAIL) {
    return {
      sent: false,
      skipped: true,
      reason: "sender_not_configured",
    };
  }

  if (await wasReminderSent(row.id, daysRemaining)) {
    return { sent: false, skipped: true, reason: "already_sent" };
  }

  const session = await getShopSession(row.shop_domain);
  const storeName = "Sonova Team";

  const eligibilityEndDate = formatDisplayDate(
    purchaseWindow.lastEligibleDate || purchaseWindow.purchaseExpiryDate
  );

  const html = ExtendedWarrantyEligibilityReminderTemplate({
    customerName: row.customer_name,
    productTitle: row.product_name,
    serialNumber: row.serial_number,
    daysRemaining,
    eligibilityEndDate,
    extendWarrantyUrl:
      buildMyProductsLoginUrl(row.shop_domain) ||
      `https://${row.shop_domain}/pages/my-products`,
    productDetailsHtml: renderViewProductDetailsButton(
      row.shop_domain,
      row.id
    ),
    storeName,
  });

  const result = await sendShopEmail({
    shopId,
    templateKey: "extended_warranty_reminder",
    to: row.customer_email,
    data: {
      customerName: row.customer_name || "Customer",
      productName: row.product_name,
      warrantyNumber: row.serial_number,
      warrantyExpiry: eligibilityEndDate,
      storeName,
    },
    renderDefault: async () => ({
      subject: `Reminder: ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} left to extend your warranty`,
      html,
      from: process.env.DEFAULT_FROM_EMAIL,
    }),
  });

  if (result.success) {
    try {
      await recordReminderSent(shopId, row.id, daysRemaining);
    } catch (recordErr) {
      console.error(
        `⚠️ EW reminder sent but log insert failed for registration ${row.id}:`,
        recordErr.message
      );
    }
    return { sent: true, testMode: result.testMode };
  }

  if (result.skipped || result.testMode) {
    return {
      sent: false,
      skipped: true,
      reason: result.error || "email_skipped",
    };
  }

  return {
    sent: false,
    skipped: false,
    error: result.error || "Email send failed",
    statusCode: result.statusCode || null,
  };
}

export async function sendExtendedWarrantyEligibilityReminders() {
  const candidates = await loadReminderCandidates();
  const summary = {
    checked: candidates.length,
    sent: 0,
    skipped: 0,
    errors: 0,
    errorDetails: [],
    skipReasons: {},
  };

  const settingsCache = new Map();
  const reminderDaysCache = new Map();

  const getCachedSettings = async shopId => {
    if (!settingsCache.has(shopId)) {
      settingsCache.set(shopId, await getExtendedWarrantySettings(shopId));
    }
    return settingsCache.get(shopId);
  };

  const getCachedReminderDays = async shopId => {
    if (!reminderDaysCache.has(shopId)) {
      reminderDaysCache.set(
        shopId,
        normalizeReminderDays(await getReminderDaysForShop(shopId))
      );
    }
    return reminderDaysCache.get(shopId);
  };

  const trackSkip = reason => {
    summary.skipped += 1;
    summary.skipReasons[reason] = (summary.skipReasons[reason] || 0) + 1;
  };

  for (const row of candidates) {
    const reminderDays = await getCachedReminderDays(row.shop_id);

    if (!reminderDays.length) {
      trackSkip("no_reminder_days_configured");
      continue;
    }

    let purchaseWindow;
    try {
      const settings = await getCachedSettings(row.shop_id);
      if (!isExtendedWarrantyOfferEnabled(settings)) {
        trackSkip("feature_disabled");
        continue;
      }
      purchaseWindow = evaluatePurchaseWindowFromSettings(settings, row);
    } catch (err) {
      summary.errors += 1;
      summary.errorDetails.push({
        registrationId: row.id,
        email: row.customer_email,
        stage: "eligibility",
        error: err.message,
      });
      console.error(
        `❌ EW reminder eligibility check failed for registration ${row.id}:`,
        err.message
      );
      continue;
    }

    if (!purchaseWindow.allowed || !purchaseWindow.configured) {
      trackSkip("purchase_window_expired");
      continue;
    }

    const daysRemaining = Number(purchaseWindow.daysRemaining);
    const applicableReminderDays = reminderDays.filter(
      day => day <= Number(purchaseWindow.extendedWarrantyPurchaseDays)
    );

    if (!applicableReminderDays.length) {
      trackSkip("reminder_days_exceed_purchase_window");
      continue;
    }

    if (!applicableReminderDays.includes(daysRemaining)) {
      trackSkip("days_remaining_not_configured");
      continue;
    }

    try {
      const outcome = await sendReminderForRegistration(row, purchaseWindow);
      if (outcome.sent) {
        summary.sent += 1;
        console.log(
          `📧 EW eligibility reminder (${daysRemaining}d) sent to ${row.customer_email} for registration ${row.id}`
        );
      } else if (outcome.error && !outcome.skipped) {
        summary.errors += 1;
        summary.errorDetails.push({
          registrationId: row.id,
          email: row.customer_email,
          daysRemaining,
          stage: "email",
          error: outcome.error,
          statusCode: outcome.statusCode || null,
        });
        console.error(
          `❌ EW reminder email failed for registration ${row.id} (${row.customer_email}):`,
          outcome.error,
          outcome.statusCode ? `(HTTP ${outcome.statusCode})` : ""
        );
      } else {
        trackSkip(outcome.reason || "send_skipped");
      }
    } catch (err) {
      summary.errors += 1;
      summary.errorDetails.push({
        registrationId: row.id,
        email: row.customer_email,
        stage: "send",
        error: err.message,
      });
      console.error(
        `❌ EW reminder failed for registration ${row.id}:`,
        err.message
      );
    }
  }

  if (summary.checked > 0 || summary.errors > 0) {
    console.log("📬 EW eligibility reminder job:", {
      checked: summary.checked,
      sent: summary.sent,
      skipped: summary.skipped,
      errors: summary.errors,
      skipReasons: summary.skipReasons,
    });
    if (summary.errorDetails.length) {
      console.error(
        "📬 EW reminder failures (sample):",
        summary.errorDetails.slice(0, 5)
      );
    }
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