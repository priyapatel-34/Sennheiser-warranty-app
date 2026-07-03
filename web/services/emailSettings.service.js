import { pool } from "../db/mysql.js";
import { renderEmailLayout } from "../emailTemp/_layout.js";
import { sendEmailService } from "./email.service.js";
import {
  renderViewProductDetailsButton,
  buildMyProductsLoginUrl,
} from "./emailLink.service.js";
import WarrantyRegistrationSuccessTemplate from "../emailTemp/standard_warranty.js";
import ExtendedWarrantyPurchaseTemplate from "../emailTemp/extended_warranty_purchase.js";
import ExtendedWarrantyEligibilityReminderTemplate from "../emailTemp/extended_warranty_eligibility_reminder.js";
import ExtendedWarrantyRefundApprovedTemplate from "../emailTemp/extended_warranty_refund_approved.js";
import ExtendedWarrantyRefundRejectedTemplate from "../emailTemp/extended_warranty_refund_rejected.js";

const SIGN_OFF_MARKER = '<p style="margin-top:30px;">';
const EMAIL_TEAM_NAME = "Sonova Team";

export function injectExtraEmailContent(fullHtml, extraHtml) {
  const extra = String(extraHtml || "").trim();
  if (!extra) return fullHtml;

  const block = `<div class="admin-email-extra" style="margin-top:20px;">${extra}</div>`;
  if (fullHtml.includes(SIGN_OFF_MARKER)) {
    return fullHtml.replace(SIGN_OFF_MARKER, `${block}\n          ${SIGN_OFF_MARKER}`);
  }
  return `${fullHtml}\n${block}`;
}

function buildSampleProductDetailsHtml(data) {
  const registerId = data.registerId || data.warrantyNumber;
  const shopDomain = data.shopDomain;
  if (!registerId || !shopDomain) return "";
  return renderViewProductDetailsButton(shopDomain, registerId);
}

function buildSampleExtendWarrantyUrl(data) {
  if (!data.shopDomain) return "";
  return buildMyProductsLoginUrl(data.shopDomain) || "";
}

function renderBuiltInEmailHtml(templateKey, sampleData = {}) {
  const data = { ...sampleData };
  const productDetailsHtml = buildSampleProductDetailsHtml(data);

  switch (templateKey) {
    case "standard_warranty":
      return WarrantyRegistrationSuccessTemplate({
        customerName: data.customerName,
        productTitle: data.productName,
        orderNumber: data.orderNumber,
        purchaseDate: data.purchaseDate,
        warrantyPeriod: data.warrantyDuration,
        productDetailsHtml,
      });
    case "extended_warranty_purchase":
      return ExtendedWarrantyPurchaseTemplate({
        customerName: data.customerName,
        productTitle: data.productName,
        orderNumber: data.orderNumber,
        planName: data.planName,
        durationMonths: data.durationMonths,
        price: data.price,
        currency: data.currency,
        serialNumber: data.warrantyNumber,
        activationDate: data.registrationDate,
        expiryDate: data.warrantyExpiry,
        productDetailsHtml,
      });
    case "extended_warranty_reminder":
      return ExtendedWarrantyEligibilityReminderTemplate({
        customerName: data.customerName,
        productTitle: data.productName,
        serialNumber: data.warrantyNumber,
        daysRemaining: data.daysRemaining,
        eligibilityEndDate: data.warrantyExpiry,
        extendWarrantyUrl: buildSampleExtendWarrantyUrl(data),
        productDetailsHtml,
      });
    case "extended_warranty_refund_approved":
      return ExtendedWarrantyRefundApprovedTemplate({
        customerName: data.customerName,
        productTitle: data.productName,
        planName: data.planName,
        refundAmount: data.refundAmount,
        currency: data.currency,
        productDetailsHtml,
      });
    case "extended_warranty_refund_rejected":
      return ExtendedWarrantyRefundRejectedTemplate({
        customerName: data.customerName,
        productTitle: data.productName,
        planName: data.planName,
        rejectionReason: data.rejectionReason,
        productDetailsHtml,
      });
    default:
      return renderEmailLayout({
        heading: "Email preview",
        bodyHtml: "<p>Preview is not available for this template.</p>",
        storeName: EMAIL_TEAM_NAME,
      });
  }
}

export const EMAIL_TEMPLATE_DEFINITIONS = {
  standard_warranty: {
    label: "Standard Warranty Registration",
    defaultSubject: "Your Product Standard Warranty Registration is Completed.",
    heading: "Standard Warranty Registration Successful",
    sampleData: {
      customerName: "Jane Customer",
      productName: "ACCENTUM Wireless",
      orderNumber: "JP-10452",
      purchaseDate: "2026-01-15",
      warrantyDuration: "24 Months",
      warrantyExpiry: "2028-06-01",
      registrationDate: "2026-06-01",
      warrantyNumber: "100245",
      registerId: "100245",
      storeName: EMAIL_TEAM_NAME,
    },
  },
  extended_warranty_purchase: {
    label: "Extended Warranty Purchased",
    defaultSubject: "Extended Warranty Purchase Confirmation",
    heading: "Extended Warranty Purchase Confirmation",
    sampleData: {
      customerName: "Jane Customer",
      productName: "ACCENTUM Wireless",
      orderNumber: "JP-10452",
      planName: "+2 Year",
      warrantyDuration: "24 Months",
      durationMonths: 24,
      price: "99.00",
      currency: "USD",
      registerId: "100245",
      warrantyNumber: "SN-ABC123",
      registrationDate: "2028-06-01",
      warrantyExpiry: "2030-06-01",
      storeName: EMAIL_TEAM_NAME,
    },
  },
  extended_warranty_reminder: {
    label: "Reminder Email",
    defaultSubject: "Reminder: extend your warranty",
    heading: "Extended Warranty Offer Ending Soon",
    sampleData: {
      customerName: "Jane Customer",
      productName: "ACCENTUM Wireless",
      warrantyNumber: "SN-ABC123",
      registerId: "100245",
      warrantyExpiry: "2026-07-01",
      daysRemaining: 7,
      storeName: EMAIL_TEAM_NAME,
    },
  },
  extended_warranty_refund_approved: {
    label: "Refund Approved",
    defaultSubject: "Extended Warranty Refund Approved",
    heading: "Extended Warranty Refund Approved",
    sampleData: {
      customerName: "Jane Customer",
      productName: "ACCENTUM Wireless",
      planName: "+2 Year",
      refundAmount: "99.00",
      currency: "USD",
      registerId: "100245",
      warrantyNumber: "100245",
      storeName: EMAIL_TEAM_NAME,
    },
  },
  extended_warranty_refund_rejected: {
    label: "Refund Rejected",
    defaultSubject: "Extended Warranty Refund Request Update",
    heading: "Extended Warranty Refund Request Update",
    sampleData: {
      customerName: "Jane Customer",
      productName: "ACCENTUM Wireless",
      planName: "+2 Year",
      rejectionReason: "Documentation incomplete",
      registerId: "100245",
      warrantyNumber: "100245",
      storeName: EMAIL_TEAM_NAME,
    },
  },
};

const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function interpolateTemplate(template, data = {}) {
  if (!template) return "";
  return String(template).replace(PLACEHOLDER_PATTERN, (_match, key) => {
    const value = data[key];
    return value == null || value === "" ? "" : String(value);
  });
}

export function findInvalidPlaceholders(body, allowedPlaceholders = []) {
  const allowed = new Set(allowedPlaceholders);
  const invalid = new Set();
  const matches = String(body || "").matchAll(PLACEHOLDER_PATTERN);
  for (const match of matches) {
    if (!allowed.has(match[1])) invalid.add(match[1]);
  }
  return [...invalid];
}

async function getShopGlobalSettings(shopId) {
  const [[row]] = await pool.query(
    `SELECT global_enabled FROM email_settings WHERE shop_id = ?`,
    [shopId]
  );
  return { globalEnabled: row ? Boolean(row.global_enabled) : true };
}

async function getShopTemplateRow(shopId, templateKey) {
  const [[row]] = await pool.query(
    `
    SELECT enabled, subject, body_html
    FROM email_template_settings
    WHERE shop_id = ? AND template_key = ?
    `,
    [shopId, templateKey]
  );
  return row || null;
}

export async function getEmailSettingsForShop(shopId) {
  const globalSettings = await getShopGlobalSettings(shopId);
  const [rows] = await pool.query(
    `
    SELECT template_key, enabled, subject, body_html
    FROM email_template_settings
    WHERE shop_id = ?
    `,
    [shopId]
  );
  const savedByKey = Object.fromEntries(rows.map((r) => [r.template_key, r]));

  const templates = Object.entries(EMAIL_TEMPLATE_DEFINITIONS).map(
    ([key, def]) => {
      const saved = savedByKey[key];
      return {
        key,
        label: def.label,
        description: def.description || "",
        enabled: saved ? Boolean(saved.enabled) : true,
        subject: saved?.subject || def.defaultSubject,
        bodyHtml: saved?.body_html || "",
        defaultSubject: def.defaultSubject,
        sampleData: def.sampleData,
        hasExtraContent: Boolean(saved?.body_html?.trim()),
      };
    }
  );

  return {
    globalEnabled: globalSettings.globalEnabled,
    templates,
  };
}

export async function saveEmailSettingsForShop(shopId, payload = {}) {
  const globalEnabled = payload.globalEnabled !== false;

  await pool.query(
    `
    INSERT INTO email_settings (shop_id, global_enabled)
    VALUES (?, ?)
    ON DUPLICATE KEY UPDATE
      global_enabled = VALUES(global_enabled),
      updated_at = CURRENT_TIMESTAMP
    `,
    [shopId, globalEnabled ? 1 : 0]
  );

  if (!Array.isArray(payload.templates)) {
    return getEmailSettingsForShop(shopId);
  }

  for (const template of payload.templates) {
    const def = EMAIL_TEMPLATE_DEFINITIONS[template.key];
    if (!def) continue;

    const subject = String(template.subject || "").trim();
    const bodyHtml = String(template.bodyHtml || "").trim();

    if (!subject) {
      throw new Error(`Subject is required for ${def.label}`);
    }

    await pool.query(
      `
      INSERT INTO email_template_settings (
        shop_id, template_key, enabled, subject, body_html
      ) VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        enabled = VALUES(enabled),
        subject = VALUES(subject),
        body_html = VALUES(body_html),
        updated_at = CURRENT_TIMESTAMP
      `,
      [
        shopId,
        template.key,
        template.enabled === false ? 0 : 1,
        subject,
        bodyHtml || null,
      ]
    );
  }

  return getEmailSettingsForShop(shopId);
}

export function previewEmailTemplate(templateKey, { subject, bodyHtml, sampleData } = {}) {
  const def = EMAIL_TEMPLATE_DEFINITIONS[templateKey];
  if (!def) throw new Error("Unknown template");

  const data = { ...def.sampleData, ...sampleData };
  const resolvedSubject = subject?.trim() || def.defaultSubject;
  const defaultHtml = renderBuiltInEmailHtml(templateKey, data);
  const html = bodyHtml?.trim()
    ? injectExtraEmailContent(defaultHtml, bodyHtml.trim())
    : defaultHtml;

  return { subject: resolvedSubject, html };
}

export async function sendShopEmail({
  shopId,
  templateKey,
  to,
  data = {},
  renderDefault,
}) {
  if (!to) return { success: false, error: "Missing recipient" };

  const globalSettings = await getShopGlobalSettings(shopId);
  if (!globalSettings.globalEnabled) {
    return { success: true, skipped: true, reason: "global_disabled" };
  }

  const def = EMAIL_TEMPLATE_DEFINITIONS[templateKey];
  if (!def && typeof renderDefault !== "function") {
    return { success: false, error: "Unknown template" };
  }

  const saved = await getShopTemplateRow(shopId, templateKey);
  if (def && saved && !saved.enabled) {
    return { success: true, skipped: true, reason: "template_disabled" };
  }

  let subject;
  let html;

  if (typeof renderDefault !== "function") {
    return { success: false, error: "No template renderer available" };
  }

  const rendered = await renderDefault();
  subject = saved?.subject?.trim()
    ? interpolateTemplate(saved.subject, data)
    : rendered.subject;
  html = rendered.html;

  if (saved?.body_html?.trim()) {
    html = injectExtraEmailContent(html, saved.body_html.trim());
  }

  return sendEmailService({
    to,
    subject,
    html,
    from: process.env.DEFAULT_FROM_EMAIL,
  });
}
