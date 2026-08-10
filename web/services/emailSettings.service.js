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

/**
 * Inserts merchant-authored extra content into the rendered email layout while
 * preserving the built-in template structure and sign-off placement.
 */
export function injectExtraEmailContent(fullHtml, extraHtml) {
  const extra = String(extraHtml || "").trim();
  if (!extra) return fullHtml;

  const block = `<div class="admin-email-extra" style="margin-top:20px;">${extra}</div>`;
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

/**
 * Renders one of the built-in email templates using sample data so merchants
 * can preview the app's default message before adding custom content.
 */
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
    `SELECT global_enabled FROM email_settings WHERE shop_id = ?`,
    [shopId]
  );
  return { globalEnabled: row ? Boolean(row.global_enabled) : true };
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
    templates,
  };
}

/**
 * Persists the global email toggle and any template-specific overrides for the
 * shop, then reloads the resolved settings snapshot for the UI.
 */
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


// import { pool } from "../db/mysql.js";
// import { sendEmailService, getEmailDeliveryStatus } from "./email.service.js";
// import {
//   buildMyProductsLoginUrl,
//   buildProductDetailsUrl,
//   buildShopUrl,
//   buildPrivacyPolicyUrl,
//   buildTermsPolicyUrl,
// } from "./emailLink.service.js";
// import WarrantyRegistrationSuccessTemplate from "../emailTemp/standard_warranty.js";
// import ExtendedWarrantyPurchaseTemplate from "../emailTemp/extended_warranty_purchase.js";
// import ExtendedWarrantyEligibilityReminderTemplate from "../emailTemp/extended_warranty_eligibility_reminder.js";
// import ExtendedWarrantyRefundApprovedTemplate from "../emailTemp/extended_warranty_refund_approved.js";
// import ExtendedWarrantyRefundRejectedTemplate from "../emailTemp/extended_warranty_refund_rejected.js";

// export const EMAIL_TEMPLATE_DEFINITIONS = {
//   standard_warranty: {
//     label: "Standard Warranty Registration",
//     defaultSubject: "Your Product Standard Warranty Registration is Completed.",
//     sampleData: {
//       customerName: "Jane Customer",
//       productName: "ACCENTUM Wireless",
//       serialNumber: "SN-ABC123",
//       orderNumber: "JP-10452",
//       purchaseDate: "15 Jan 2026",
//       warrantyStartDate: "01 Jun 2026",
//       registrationDate: "01 Jun 2026",
//       warrantyExpiry: "01 Jun 2028",
//       warrantyDuration: "24 Months",
//       registerId: "100245",
//       shopDomain: "sennheiser-hearing.com",
//     },
//   },
//   extended_warranty_purchase: {
//     label: "Extended Warranty Purchased",
//     defaultSubject: "Extended Warranty Purchase Confirmation",
//     sampleData: {
//       customerName: "Jane Customer",
//       productName: "ACCENTUM Wireless",
//       serialNumber: "SN-ABC123",
//       orderNumber: "JP-10452",
//       planName: "+2 Year",
//       durationMonths: 24,
//       price: "99.00",
//       currency: "USD",
//       registerId: "100245",
//       activationDate: "01 Jun 2028",
//       expiryDate: "01 Jun 2030",
//       shopDomain: "sennheiser-hearing.com",
//     },
//   },
//   extended_warranty_reminder: {
//     label: "Reminder Email",
//     defaultSubject: "Reminder: extend your warranty",
//     sampleData: {
//       customerName: "Jane Customer",
//       productName: "ACCENTUM Wireless",
//       serialNumber: "SN-ABC123",
//       registerId: "100245",
//       warrantyExpiry: "01 Jul 2028",
//       offerExpiryDate: "01 Jul 2026",
//       daysRemaining: 7,
//       shopDomain: "sennheiser-hearing.com",
//       plans: [
//         {
//           planName: "+1 Year",
//           startDate: "01 Jul 2028",
//           endDate: "01 Jul 2029",
//           price: "49.00 USD",
//         },
//         {
//           planName: "+2 Years",
//           startDate: "01 Jul 2028",
//           endDate: "01 Jul 2030",
//           price: "99.00 USD",
//           featured: true,
//         },
//         {
//           planName: "+3 Years",
//           startDate: "01 Jul 2028",
//           endDate: "01 Jul 2031",
//           price: "129.00 USD",
//         },
//       ],
//       coverageBenefits: [
//         "Comprehensive coverage for mechanical and electrical breakdowns",
//         "100% coverage for repairs including labour — not just parts",
//         "Coverage for wear and tear affecting product functionality",
//         "Replacement or reimbursement if we cannot repair it",
//       ].join("\n"),
//     },
//   },
//   extended_warranty_refund_approved: {
//     label: "Refund Approved",
//     defaultSubject: "Extended Warranty Refund Approved",
//     sampleData: {
//       customerName: "Jane Customer",
//       productName: "ACCENTUM Wireless",
//       serialNumber: "SN-ABC123",
//       planName: "+2 Year",
//       refundAmount: "99.00 USD",
//       processedDate: "01 Jun 2026",
//       registerId: "100245",
//       shopDomain: "sennheiser-hearing.com",
//     },
//   },
//   extended_warranty_refund_rejected: {
//     label: "Refund Rejected",
//     defaultSubject: "Extended Warranty Refund Request Update",
//     sampleData: {
//       customerName: "Jane Customer",
//       productName: "ACCENTUM Wireless",
//       serialNumber: "SN-ABC123",
//       planName: "+2 Year",
//       rejectionReason: "Documentation incomplete",
//       processedDate: "01 Jun 2026",
//       registerId: "100245",
//       shopDomain: "sennheiser-hearing.com",
//     },
//   },
// };

// /**
//  * `body_html` stores optional plain-text Additional Notes per template.
//  * Legacy installs may still have HTML from the old rich-text editor — strip
//  * tags on read so existing content is preserved as readable plain text.
//  */
// export function resolveAdditionalNotes(rawBodyHtml) {
//   if (!rawBodyHtml?.trim()) return "";
//   const text = rawBodyHtml.trim();
//   if (!/<[a-z][\s\S]*>/i.test(text)) return text;

//   return text
//     .replace(/<br\s*\/?>/gi, "\n")
//     .replace(/<\/p>/gi, "\n")
//     .replace(/<[^>]+>/g, "")
//     .replace(/&nbsp;/g, " ")
//     .replace(/&amp;/g, "&")
//     .replace(/&lt;/g, "<")
//     .replace(/&gt;/g, ">")
//     .replace(/&quot;/g, '"')
//     .replace(/&#39;/g, "'")
//     .replace(/\n{3,}/g, "\n\n")
//     .trim();
// }

// function buildSampleUrls(shopDomain, registerId) {
//   const domain = shopDomain || "example.myshopify.com";
//   return {
//     myProductsUrl: buildProductDetailsUrl(domain, registerId),
//     shopUrl: buildShopUrl(domain),
//     supportUrl: buildShopUrl(domain),
//     privacyUrl: buildPrivacyPolicyUrl(domain),
//     termsUrl: buildTermsPolicyUrl(domain),
//     upsellUrl: buildMyProductsLoginUrl(domain) || buildShopUrl(domain, "/pages/my-products"),
//     unsubscribeUrl: buildShopUrl(domain, "/account"),
//   };
// }

// function renderBuiltInEmailHtml(templateKey, sampleData = {}, additionalNotes = "") {
//   const data = { ...sampleData };
//   const urls = buildSampleUrls(data.shopDomain, data.registerId);

//   switch (templateKey) {
//     case "standard_warranty":
//       return WarrantyRegistrationSuccessTemplate({
//         customerName: data.customerName,
//         productTitle: data.productName,
//         serialNumber: data.serialNumber || data.warrantyNumber,
//         registrationDate: data.registrationDate,
//         purchaseDate: data.purchaseDate,
//         warrantyStartDate: data.warrantyStartDate || data.registrationDate,
//         warrantyExpiry: data.warrantyExpiry,
//         myProductsUrl: urls.myProductsUrl,
//         shopUrl: urls.shopUrl,
//         supportUrl: urls.supportUrl,
//         privacyUrl: urls.privacyUrl,
//         termsUrl: urls.termsUrl,
//         additionalNotes,
//       });
//     case "extended_warranty_purchase":
//       return ExtendedWarrantyPurchaseTemplate({
//         customerName: data.customerName,
//         productTitle: data.productName,
//         serialNumber: data.serialNumber || data.warrantyNumber,
//         planName: data.planName,
//         price: data.price,
//         currency: data.currency,
//         activationDate: data.activationDate || data.registrationDate,
//         expiryDate: data.warrantyExpiry || data.expiryDate,
//         myProductsUrl: urls.myProductsUrl,
//         shopUrl: urls.shopUrl,
//         supportUrl: urls.supportUrl,
//         privacyUrl: urls.privacyUrl,
//         termsUrl: urls.termsUrl,
//         additionalNotes,
//       });
//     case "extended_warranty_reminder":
//       return ExtendedWarrantyEligibilityReminderTemplate({
//         customerName: data.customerName,
//         productTitle: data.productName,
//         serialNumber: data.serialNumber || data.warrantyNumber,
//         daysRemaining: data.daysRemaining,
//         warrantyExpiryDate: data.warrantyExpiry,
//         offerExpiryDate: data.offerExpiryDate || data.warrantyExpiry,
//         plans: data.plans || [],
//         upsellUrl: urls.upsellUrl,
//         supportUrl: urls.supportUrl,
//         privacyUrl: urls.privacyUrl,
//         termsUrl: urls.termsUrl,
//         unsubscribeUrl: urls.unsubscribeUrl,
//         additionalNotes,
//         coverageBenefits: data.coverageBenefits,
//       });
//     case "extended_warranty_refund_approved":
//       return ExtendedWarrantyRefundApprovedTemplate({
//         customerName: data.customerName,
//         productTitle: data.productName,
//         serialNumber: data.serialNumber,
//         planName: data.planName,
//         refundAmount: data.refundAmount,
//         currency: data.currency,
//         processedDate: data.processedDate,
//         myProductsUrl: urls.myProductsUrl,
//         shopUrl: urls.shopUrl,
//         supportUrl: urls.supportUrl,
//         privacyUrl: urls.privacyUrl,
//         termsUrl: urls.termsUrl,
//         additionalNotes,
//       });
//     case "extended_warranty_refund_rejected":
//       return ExtendedWarrantyRefundRejectedTemplate({
//         customerName: data.customerName,
//         productTitle: data.productName,
//         serialNumber: data.serialNumber,
//         planName: data.planName,
//         rejectionReason: data.rejectionReason,
//         processedDate: data.processedDate,
//         myProductsUrl: urls.myProductsUrl,
//         shopUrl: urls.shopUrl,
//         supportUrl: urls.supportUrl,
//         privacyUrl: urls.privacyUrl,
//         termsUrl: urls.termsUrl,
//         additionalNotes,
//       });
//     default:
//       return "<p>Preview is not available for this template.</p>";
//   }
// }

// async function getShopGlobalSettings(shopId) {
//   const [[row]] = await pool.query(
//     `SELECT global_enabled FROM email_settings WHERE shop_id = ?`,
//     [shopId]
//   );
//   return {
//     globalEnabled: !row || Number(row.global_enabled) !== 0,
//   };
// }

// function isTemplateEnabled(saved) {
//   if (!saved) return true;
//   return Number(saved.enabled) !== 0;
// }

// export { getEmailDeliveryStatus };

// async function getShopTemplateRow(shopId, templateKey) {
//   const [[row]] = await pool.query(
//     `
//     SELECT enabled, body_html
//     FROM email_template_settings
//     WHERE shop_id = ? AND template_key = ?
//     `,
//     [shopId, templateKey]
//   );
//   return row || null;
// }

// async function getCoverageTextForShop(shopId) {
//   if (!shopId) return "";
//   const [[row]] = await pool.query(
//     `SELECT coverage_text FROM extended_warranty_settings WHERE shop_id = ?`,
//     [shopId]
//   );
//   return row?.coverage_text || "";
// }

// export async function getEmailSettingsForShop(shopId) {
//   const globalSettings = await getShopGlobalSettings(shopId);
//   const [rows] = await pool.query(
//     `
//     SELECT template_key, enabled, body_html
//     FROM email_template_settings
//     WHERE shop_id = ?
//     `,
//     [shopId]
//   );
//   const savedByKey = Object.fromEntries(rows.map((r) => [r.template_key, r]));

//   const templates = Object.entries(EMAIL_TEMPLATE_DEFINITIONS).map(
//     ([key, def]) => {
//       const saved = savedByKey[key];
//       return {
//         key,
//         label: def.label,
//         enabled: isTemplateEnabled(saved),
//         additionalNotes: resolveAdditionalNotes(saved?.body_html),
//         defaultSubject: def.defaultSubject,
//       };
//     }
//   );

//   return {
//     globalEnabled: globalSettings.globalEnabled,
//     delivery: getEmailDeliveryStatus(),
//     templates,
//   };
// }

// export async function saveEmailSettingsForShop(shopId, payload = {}) {
//   const globalEnabled = payload.globalEnabled !== false;

//   await pool.query(
//     `
//     INSERT INTO email_settings (shop_id, global_enabled)
//     VALUES (?, ?)
//     ON DUPLICATE KEY UPDATE
//       global_enabled = VALUES(global_enabled),
//       updated_at = CURRENT_TIMESTAMP
//     `,
//     [shopId, globalEnabled ? 1 : 0]
//   );

//   if (!Array.isArray(payload.templates)) {
//     return getEmailSettingsForShop(shopId);
//   }

//   for (const template of payload.templates) {
//     const def = EMAIL_TEMPLATE_DEFINITIONS[template.key];
//     if (!def) continue;

//     const additionalNotes = String(template.additionalNotes ?? "").trim();

//     await pool.query(
//       `
//       INSERT INTO email_template_settings (
//         shop_id, template_key, enabled, subject, body_html
//       ) VALUES (?, ?, ?, ?, ?)
//       ON DUPLICATE KEY UPDATE
//         enabled = VALUES(enabled),
//         body_html = VALUES(body_html),
//         updated_at = CURRENT_TIMESTAMP
//       `,
//       [
//         shopId,
//         template.key,
//         template.enabled === false ? 0 : 1,
//         def.defaultSubject,
//         additionalNotes || null,
//       ]
//     );
//   }

//   return getEmailSettingsForShop(shopId);
// }

// export async function previewEmailTemplate(
//   templateKey,
//   { shopId, additionalNotes: overrideNotes } = {}
// ) {
//   const def = EMAIL_TEMPLATE_DEFINITIONS[templateKey];
//   if (!def) throw new Error("Unknown template");

//   let additionalNotes = "";
//   if (overrideNotes !== undefined && overrideNotes !== null) {
//     additionalNotes = String(overrideNotes).trim();
//   } else if (shopId) {
//     const saved = await getShopTemplateRow(shopId, templateKey);
//     additionalNotes = resolveAdditionalNotes(saved?.body_html);
//   }

//   const sampleData = { ...def.sampleData };
//   if (templateKey === "extended_warranty_reminder" && shopId) {
//     sampleData.coverageBenefits = await getCoverageTextForShop(shopId);
//   }

//   const html = renderBuiltInEmailHtml(
//     templateKey,
//     sampleData,
//     additionalNotes
//   );

//   return { subject: def.defaultSubject, html };
// }

// export async function sendShopEmail({
//   shopId,
//   templateKey,
//   to,
//   renderDefault,
// }) {
//   if (!to) return { success: false, error: "Missing recipient" };

//   const globalSettings = await getShopGlobalSettings(shopId);
//   if (!globalSettings.globalEnabled) {
//     console.warn("Email skipped: global notifications disabled", { shopId, templateKey, to });
//     return { success: true, skipped: true, reason: "global_disabled" };
//   }

//   const def = EMAIL_TEMPLATE_DEFINITIONS[templateKey];
//   if (!def && typeof renderDefault !== "function") {
//     return { success: false, error: "Unknown template" };
//   }

//   const saved = await getShopTemplateRow(shopId, templateKey);
//   if (def && saved && !isTemplateEnabled(saved)) {
//     console.warn("Email skipped: template disabled", { shopId, templateKey, to });
//     return { success: true, skipped: true, reason: "template_disabled" };
//   }

//   if (typeof renderDefault !== "function") {
//     return { success: false, error: "No template renderer available" };
//   }

//   const delivery = getEmailDeliveryStatus();
//   if (!delivery.ready) {
//     const error = delivery.sendgridConfigured
//       ? "Sender email is not configured (DEFAULT_FROM_EMAIL)"
//       : "SendGrid is not configured (SENDGRID_API_KEY)";
//     console.error("Email send blocked:", error, { shopId, templateKey, to });
//     return { success: false, error };
//   }

//   const additionalNotes = resolveAdditionalNotes(saved?.body_html);
//   const rendered = await renderDefault({ additionalNotes });

//   const subject = rendered.subject || def?.defaultSubject;
//   const html = rendered.html;

//   const result = await sendEmailService({
//     to,
//     subject,
//     html,
//   });

//   if (!result.success) {
//     console.error("Email send failed", {
//       shopId,
//       templateKey,
//       to,
//       error: result.error,
//       statusCode: result.statusCode,
//     });
//   }

//   return result;
// }
