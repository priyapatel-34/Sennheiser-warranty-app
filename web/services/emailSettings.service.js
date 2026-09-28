import { pool } from "../db/mysql.js";
import { ADMIN_EMAIL_EXTRA_MARKER, renderEmailLayout } from "../emailTemp/_layout.js";
import { sendEmailService } from "./email.service.js";
import {
  renderViewProductDetailsButton,
  buildMyProductsLoginUrl,
  buildProductDetailsUrl,
} from "./emailLink.service.js";
import WarrantyRegistrationSuccessTemplate from "../emailTemp/standard_warranty.js";
import WarrantyRegistrationSuccessTemplateJA from "../emailTemp/standard_warranty_ja.js";
import ExtendedWarrantyPurchaseTemplate from "../emailTemp/extended_warranty_purchase.js";
import ExtendedWarrantyEligibilityReminderTemplate from "../emailTemp/extended_warranty_eligibility_reminder.js";
import ExtendedWarrantyRefundApprovedTemplate from "../emailTemp/extended_warranty_refund_approved.js";
import ExtendedWarrantyRefundRejectedTemplate from "../emailTemp/extended_warranty_refund_rejected.js";

const SIGN_OFF_MARKER = '<p style="margin-top:30px;">';
const EMAIL_TEAM_NAME = "Sennheiser Hearing";

/**
 * Inserts merchant-authored extra content into the rendered email layout while
 * preserving the built-in template structure and sign-off placement.
 */
export function injectExtraEmailContent(fullHtml, extraHtml) {
  const extra = String(extraHtml || "").trim();
  if (!extra) return fullHtml;

  const block = `<div class="admin-email-extra" style=" margin-bottom:20px; font-size:12px">${extra}</div>`;
  if (fullHtml.includes(ADMIN_EMAIL_EXTRA_MARKER)) {
    return fullHtml.replace(ADMIN_EMAIL_EXTRA_MARKER, `${block}\n${ADMIN_EMAIL_EXTRA_MARKER}`);
  }
  if (fullHtml.includes(SIGN_OFF_MARKER)) {
    return fullHtml.replace(SIGN_OFF_MARKER, `${block}\n          ${SIGN_OFF_MARKER}`);
  }
  return `${fullHtml}\n${block}`;
}

/**
 * Builds the sample product-details CTA used in template previews when the
 * preview data contains a registration id and storefront domain.
 */
function buildSampleProductDetailsHtml(data) {
  const registerId = data.registerId || data.warrantyNumber;
  const shopDomain = data.shopDomain;
  if (!registerId || !shopDomain) return "";
  return renderViewProductDetailsButton(shopDomain, registerId);
}

/**
 * Builds the preview-time extended-warranty CTA URL from the sample shop data.
 */
function buildSampleExtendWarrantyUrl(data) {
  if (!data.shopDomain) return "";
  return buildMyProductsLoginUrl(data.shopDomain) || "";
}

function sampleViewWarrantyUrl(data) {
  return buildProductDetailsUrl(data.shopDomain, data.registerId) || "";
}

/**
 * Renders one of the built-in email templates using sample data so merchants
 * can preview the app's default message before adding custom content.
 */
function renderBuiltInEmailHtml(templateKey, sampleData = {}) {
  const data = { ...sampleData };
  const productDetailsHtml = buildSampleProductDetailsHtml(data);
  const viewWarrantyUrl = sampleViewWarrantyUrl(data);
  const urls = {
    storeUrl: normalizeOptionalUrl(data.storeUrl),
    privacyUrl: normalizeOptionalUrl(data.privacyUrl),
    termsUrl: normalizeOptionalUrl(data.termsUrl),
    supportUrl: normalizeOptionalUrl(data.supportUrl),
  };

  switch (templateKey) {
    case "standard_warranty":
      return WarrantyRegistrationSuccessTemplate({
        customerName: data.customerName,
        productTitle: data.productName,
        orderNumber: data.orderNumber,
        serialNumber: data.serialNumber || data.warrantyNumber,
        purchaseDate: data.purchaseDate,
        warrantyPeriod: data.warrantyDuration,
        registrationDate: data.registrationDate,
        warrantyStartDate: data.warrantyStartDate || data.registrationDate,
        warrantyExpiry: data.warrantyExpiry,
        productDetailsHtml,
        viewWarrantyUrl,
        shopDomain: data.shopDomain,
        shopifyShop: data.shopifyShop,
        hasFreeExtendedWarranty: Boolean(data.hasFreeExtendedWarranty),
        freeExtendedWarrantySource: data.freeExtendedWarrantySource || null,
        ...urls,
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
        serialNumber: data.serialNumber || data.warrantyNumber,
        activationDate: data.activationDate || data.registrationDate,
        expiryDate: data.warrantyExpiry || data.expiryDate,
        productDetailsHtml,
        viewWarrantyUrl,
        ...urls,
      });
    case "extended_warranty_reminder":
      return ExtendedWarrantyEligibilityReminderTemplate({
        customerName: data.customerName,
        productTitle: data.productName,
        serialNumber: data.serialNumber || data.warrantyNumber,
        daysRemaining: data.daysRemaining,
        eligibilityEndDate: data.offerExpiryDate || data.warrantyExpiry,
        offerExpiryDate: data.offerExpiryDate || data.warrantyExpiry,
        warrantyExpiryDate: data.warrantyExpiry,
        plans: data.plans || [],
        coverageBenefits: data.coverageBenefits || "",
        extendWarrantyUrl: buildSampleExtendWarrantyUrl(data),
        productDetailsHtml,
        ...urls,
      });
    case "extended_warranty_refund_approved":
      return ExtendedWarrantyRefundApprovedTemplate({
        customerName: data.customerName,
        productTitle: data.productName,
        planName: data.planName,
        refundAmount: data.refundAmount,
        currency: data.currency,
        serialNumber: data.serialNumber || data.warrantyNumber,
        processedDate: data.processedDate,
        productDetailsHtml,
        viewWarrantyUrl,
        ...urls,
      });
    case "extended_warranty_refund_rejected":
      return ExtendedWarrantyRefundRejectedTemplate({
        customerName: data.customerName,
        productTitle: data.productName,
        planName: data.planName,
        rejectionReason: data.rejectionReason,
        serialNumber: data.serialNumber || data.warrantyNumber,
        processedDate: data.processedDate,
        productDetailsHtml,
        viewWarrantyUrl,
        ...urls,
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
      serialNumber: "SN-ABC123",
      orderNumber: "JP-10452",
      purchaseDate: "2026-01-15",
      warrantyStartDate: "2026-01-15",
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
      serialNumber: "SN-ABC123",
      orderNumber: "JP-10452",
      planName: "+2 Year",
      warrantyDuration: "24 Months",
      durationMonths: 24,
      price: "99.00",
      currency: "USD",
      registerId: "100245",
      warrantyNumber: "SN-ABC123",
      registrationDate: "2028-06-01",
      activationDate: "2028-06-01",
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
      serialNumber: "SN-ABC123",
      warrantyNumber: "SN-ABC123",
      registerId: "100245",
      warrantyExpiry: "2028-06-07",
      offerExpiryDate: "2026-07-01",
      daysRemaining: 7,
      storeName: EMAIL_TEAM_NAME,
      plans: [
        {
          planName: "+1 Year",
          startDate: "2027-06-07",
          endDate: "2028-06-07",
          price: "23.00",
          currency: "EUR",
        },
        {
          planName: "+2 Year",
          startDate: "2027-06-07",
          endDate: "2029-06-07",
          price: "45.00",
          currency: "EUR",
          badgeLabel: "Most Popular",
          featured: true,
        },
        {
          planName: "+3 Year",
          startDate: "2027-06-07",
          endDate: "2030-06-07",
          price: "59.00",
          currency: "EUR",
        },
      ],
      coverageBenefits: [
        "Comprehensive coverage for mechanical and electrical breakdowns",
        "100% coverage for repairs including labour — not just parts",
        "Coverage for wear and tear affecting product functionality",
        "Replacement or reimbursement if we cannot repair it",
      ].join("\n"),
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
      serialNumber: "SN-ABC123",
      processedDate: "2026-06-01",
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
      serialNumber: "SN-ABC123",
      processedDate: "2026-06-01",
      registerId: "100245",
      warrantyNumber: "100245",
      storeName: EMAIL_TEAM_NAME,
    },
  },
};

/**
 * Normalizes and validates a locale string, returning a supported base code.
 * Supported: 'en', 'ja'. Falls back to 'en'.
 */
export function normalizeLocale(locale) {
  const raw = String(locale || "").trim().toLowerCase().replace(/_/g, "-");
  if (!raw) return "en";
  if (raw.startsWith("ja")) return "ja";
  if (raw.startsWith("en")) return "en";
  return "en";
}

const JAPAN_STORE_HOST = "jp.sennheiser-hearing.com";

/**
 * True only for the Japan storefront. Accepts a bare host or a full URL,
 * with or without www, so the standard-email branch does not miss the shop.
 */
export function isJapanStoreDomain(shopDomain) {
  const host = String(shopDomain || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .replace(/:\d+$/, "")
    .replace(/^www\./, "");
  return host === JAPAN_STORE_HOST;
}

/**
 * Returns a renderer function for a built-in templateKey and locale. The
 * renderer returns an object { subject, html } when called with template data.
 */
export function getWarrantyEmailTemplate(templateKey, locale) {
  const lang = normalizeLocale(locale);

  switch (templateKey) {
    case "standard_warranty":
      if (lang === "ja") {
        return (data = {}) => ({
          subject: "製品登録が完了しました",
          html: WarrantyRegistrationSuccessTemplateJA({
            customerName: data.customerName,
            productTitle: data.productTitle || data.productName,
            orderNumber: data.orderNumber,
            purchaseDate: data.purchaseDate,
            warrantyPeriod: data.warrantyPeriod || data.warrantyDuration,
            serialNumber: data.serialNumber,
            shopDomain: data.shopDomain,
            registerId: data.registerId,
            registrationDate: data.registrationDate,
            warrantyStartDate: data.warrantyStartDate,
            warrantyExpiry: data.warrantyExpiry,
            viewWarrantyUrl: data.viewWarrantyUrl,
            storeUrl: data.storeUrl,
            privacyUrl: data.privacyUrl,
            termsUrl: data.termsUrl,
            supportUrl: data.supportUrl,
          }),
        });
      }

      // default English renderer
      return (data = {}) => ({
        subject: EMAIL_TEMPLATE_DEFINITIONS.standard_warranty.defaultSubject,
        html: WarrantyRegistrationSuccessTemplate({
          customerName: data.customerName,
          productTitle: data.productTitle || data.productName,
          orderNumber: data.orderNumber,
          purchaseDate: data.purchaseDate,
          warrantyPeriod: data.warrantyPeriod || data.warrantyDuration,
          serialNumber: data.serialNumber,
          productDetailsHtml: data.productDetailsHtml || "",
          shopDomain: data.shopDomain,
          shopifyShop: data.shopifyShop,
          hasFreeExtendedWarranty: Boolean(data.hasFreeExtendedWarranty),
          freeExtendedWarrantySource: data.freeExtendedWarrantySource || null,
          locale: data.locale,
          registrationDate: data.registrationDate,
          warrantyStartDate: data.warrantyStartDate,
          warrantyExpiry: data.warrantyExpiry,
          viewWarrantyUrl: data.viewWarrantyUrl,
          storeUrl: data.storeUrl,
          privacyUrl: data.privacyUrl,
          termsUrl: data.termsUrl,
          supportUrl: data.supportUrl,
        }),
      });
    default:
      return (data = {}) => ({
        subject: EMAIL_TEMPLATE_DEFINITIONS[templateKey]?.defaultSubject || "",
        html: renderBuiltInEmailHtml(templateKey, data),
      });
  }
}

const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * Replaces simple `{{placeholder}}` tokens in merchant-authored subjects with
 * runtime values from the email payload.
 */
export function interpolateTemplate(template, data = {}) {
  if (!template) return "";
  return String(template).replace(PLACEHOLDER_PATTERN, (_match, key) => {
    const value = data[key];
    return value == null || value === "" ? "" : String(value);
  });
}

/**
 * Detects template placeholders that are not supported by the current email
 * renderer so validation can warn merchants before they save a template.
 */
export function findInvalidPlaceholders(body, allowedPlaceholders = []) {
  const allowed = new Set(allowedPlaceholders);
  const invalid = new Set();
  const matches = String(body || "").matchAll(PLACEHOLDER_PATTERN);
  for (const match of matches) {
    if (!allowed.has(match[1])) invalid.add(match[1]);
  }
  return [...invalid];
}

/**
 * Loads the merchant-level notification toggle that controls whether any
 * transactional email should be sent for the shop.
 */
async function getShopGlobalSettings(shopId) {
  const [[row]] = await pool.query(
    `
    SELECT global_enabled, store_url, privacy_policy_url, terms_conditions_url, support_url
    FROM email_settings
    WHERE shop_id = ?
    `,
    [shopId]
  );
  return {
    globalEnabled: row ? Boolean(row.global_enabled) : true,
    urls: {
      storeUrl: normalizeOptionalUrl(row?.store_url),
      privacyUrl: normalizeOptionalUrl(row?.privacy_policy_url),
      termsUrl: normalizeOptionalUrl(row?.terms_conditions_url),
      supportUrl: normalizeOptionalUrl(row?.support_url),
    },
  };
}

/** Returns an empty value for omitted URLs and only permits safe web links. */
function normalizeOptionalUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function validateOptionalUrl(value, label) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalized = normalizeOptionalUrl(raw);
  if (!normalized) throw new Error(`${label} must be a valid http or https URL`);
  return normalized;
}

/**
 * Fetches the saved per-template customization row for a given shop.
 */
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

/**
 * Returns the effective email settings for a shop, including saved overrides
 * and built-in defaults for every supported template key.
 */
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
    urls: globalSettings.urls,
    templates,
  };
}

/**
 * Persists the global email toggle and any template-specific overrides for the
 * shop, then reloads the resolved settings snapshot for the UI.
 */
export async function saveEmailSettingsForShop(shopId, payload = {}) {
  const globalEnabled = payload.globalEnabled !== false;
  const urls = payload.urls || {};
  const storeUrl = validateOptionalUrl(urls.storeUrl, "Store URL");
  const privacyUrl = validateOptionalUrl(urls.privacyUrl, "Privacy Policy URL");
  const termsUrl = validateOptionalUrl(urls.termsUrl, "Terms & Conditions URL");
  const supportUrl = validateOptionalUrl(urls.supportUrl, "Support URL");

  await pool.query(
    `
    INSERT INTO email_settings (
      shop_id, global_enabled, store_url, privacy_policy_url, terms_conditions_url, support_url
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      global_enabled = VALUES(global_enabled),
      store_url = VALUES(store_url),
      privacy_policy_url = VALUES(privacy_policy_url),
      terms_conditions_url = VALUES(terms_conditions_url),
      support_url = VALUES(support_url),
      updated_at = CURRENT_TIMESTAMP
    `,
    [shopId, globalEnabled ? 1 : 0, storeUrl, privacyUrl, termsUrl, supportUrl]
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

/**
 * Builds a preview subject and HTML body for a template without sending email.
 */
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

/**
 * Applies shop-level template settings and then sends the final email via the
 * shared SendGrid transport, or returns a skipped response when notifications
 * are disabled.
 */
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

  const rendered = await renderDefault({ urls: globalSettings.urls });

  const isJapanStore =
    isJapanStoreDomain(data.shopDomain) ||
    isJapanStoreDomain(data.shopifyShop);
  const japaneseStandardEmail =
    templateKey === "standard_warranty" &&
    isJapanStore &&
    normalizeLocale(data.locale) === "ja";

  if (japaneseStandardEmail) {
    html = getWarrantyEmailTemplate("standard_warranty", "ja")({
      ...data,
      ...(globalSettings.urls || {}),
      productTitle: data.productTitle || data.productName,
      warrantyPeriod: data.warrantyPeriod || data.warrantyDuration,
      registerId: data.registerId || data.warrantyNumber,
    }).html;
  } else {
    html = rendered.html;
  }

  if (templateKey === "standard_warranty" && isJapanStore) {
    subject =
      normalizeLocale(data.locale) === "ja"
        ? "製品登録が完了しました"
        : "Product Registration Successful!!!";
  } else {
    subject = saved?.subject?.trim()
      ? interpolateTemplate(saved.subject, data)
      : rendered.subject;
  }

  if (saved?.body_html?.trim() && !japaneseStandardEmail) {
    html = injectExtraEmailContent(html, saved.body_html.trim());
  }

  return sendEmailService({
    to,
    subject,
    html,
    from: process.env.DEFAULT_FROM_EMAIL,
  });
}
