import { escapeHtml } from "../emailTemp/_layout.js";

/**
 * Storefront languages the warranty emails can be written in.
 * `short` is the compact admin label. `code` is what we store and match.
 */
export const EMAIL_LANGUAGE_OPTIONS = [
  { code: "zh-HK", short: "ZH-HK", label: "Chinese (Hong Kong)" },
  { code: "zh", short: "ZH", label: "Chinese" },
  { code: "ko", short: "KR", label: "Korean" },
  { code: "ja", short: "JA", label: "Japanese" },
  { code: "en", short: "EN", label: "English" },
  { code: "th", short: "TH", label: "Thai" },
  { code: "zh-TW", short: "ZH-TW", label: "Chinese (Taiwan)" },
  { code: "ar", short: "AR", label: "Arabic" },
  { code: "vi", short: "VI", label: "Vietnamese" },
  { code: "pt", short: "PT", label: "Portuguese" },
  { code: "es", short: "ES", label: "Spanish" },
  { code: "fr", short: "FR", label: "French" },
  { code: "de", short: "DE", label: "German" },
  { code: "nl", short: "NL", label: "Dutch" },
  { code: "hu", short: "HU", label: "Hungarian" },
  { code: "it", short: "IT", label: "Italian" },
];

const LOCALE_ALIASES = {
  en: "en",
  ja: "ja",
  jp: "ja",
  ko: "ko",
  kr: "ko",
  zh: "zh",
  "zh-cn": "zh",
  "zh-hans": "zh",
  "zh-hk": "zh-HK",
  "zh-tw": "zh-TW",
  "zh-hant": "zh-TW",
  th: "th",
  ar: "ar",
  vi: "vi",
  pt: "pt",
  "pt-br": "pt",
  "pt-pt": "pt",
  es: "es",
  fr: "fr",
  de: "de",
  nl: "nl",
  hu: "hu",
  it: "it",
};

export function emailLanguageLabel(code) {
  return EMAIL_LANGUAGE_OPTIONS.find((option) => option.code === code)?.label || code;
}

/**
 * Maps a storefront locale onto one of the email languages.
 * zh-HK and zh-TW stay distinct. Unknown locales return empty so the store
 * default can be used.
 */
export function normalizeLocale(locale) {
  const raw = String(locale || "").trim().toLowerCase().replace(/_/g, "-");
  if (!raw) return "";
  if (LOCALE_ALIASES[raw]) return LOCALE_ALIASES[raw];
  if (raw.startsWith("zh-hk")) return "zh-HK";
  if (raw.startsWith("zh-tw") || raw.startsWith("zh-hant")) return "zh-TW";
  if (raw.startsWith("zh")) return "zh";
  const base = raw.split("-")[0];
  return LOCALE_ALIASES[base] || "";
}

export function fillCopy(template, vars = {}) {
  return String(template ?? "")
    .split(/(\{\{\s*[a-zA-Z0-9_]+\s*\}\})/g)
    .map((part) => {
      const match = /^\{\{\s*([a-zA-Z0-9_]+)\s*\}\}$/.exec(part);
      if (!match) return escapeHtml(part);
      return escapeHtml(vars[match[1]] ?? "");
    })
    .join("");
}

/** Placeholder fill for text that a layout helper will escape itself. */
export function fillPlain(template, vars = {}) {
  return String(template ?? "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) =>
    String(vars[key] ?? "")
  );
}

export function plainToHtml(value) {
  return escapeHtml(value || "").replace(/\r?\n/g, "<br>");
}

export function copyText(copy, key, fallback) {
  const value = copy?.[key];
  return value == null || String(value).trim() === "" ? fallback : String(value);
}

const content = (key, label, help) => ({ key, label, section: "Content", multiline: true, help });
const line = (key, label, section = "Labels", help) => ({ key, label, section, help });

export const EMAIL_COPY_FIELDS = {
  standard_warranty: [
    line("heading", "Heading", "Content"),
    line("greeting", "Greeting", "Content", "Use {{name}} for the customer first name."),
    content("intro", "Introduction"),
    line("serialLabel", "Serial number label"),
    line("registeredBadge", "Registered badge"),
    line("expiresBadge", "Expiry badge", "Labels", "Use {{date}} for the expiry date."),
    line("orderNumberLabel", "Order number label"),
    line("registrationDateLabel", "Registration date label"),
    line("purchaseDateLabel", "Purchase date label"),
    line("warrantyExpiresLabel", "Warranty expires label"),
    line("buttonLabel", "Button"),
    content("purchaseNotice", "Purchase date notice"),
    line("freeWarrantyTitle", "Free warranty title", "Content"),
    content("freeWarrantyBody", "Free warranty text"),
    content("preorderWarrantyBody", "Preorder warranty text"),
    line("continueShopping", "Continue shopping", "Footer"),
    content("supportMessage", "Support message"),
    line("supportLink", "Support link", "Footer"),
    line("signOff", "Sign-off", "Footer"),
    line("footerName", "Footer name", "Footer"),
    line("privacy", "Privacy policy", "Footer"),
    line("terms", "Terms and conditions", "Footer"),
    line("copyright", "Copyright", "Footer"),
  ],
  extended_warranty_purchase: [
    line("heading", "Heading", "Content"),
    line("heroBadge", "Badge", "Content"),
    line("heroTitle", "Title", "Content"),
    content("heroSubtitle", "Subtitle"),
    line("greeting", "Greeting", "Content", "Use {{name}} for the customer first name."),
    content("intro", "Introduction"),
    line("serialLabel", "Serial number label"),
    line("activeBadge", "Status badge"),
    line("orderNumberLabel", "Order number label"),
    line("planLabel", "Plan label"),
    line("amountPaidLabel", "Amount paid label"),
    line("coverageEndsLabel", "Coverage ends label"),
    line("buttonLabel", "Button"),
    content("footerNotice", "Footer note"),
    line("continueShopping", "Continue shopping", "Footer"),
    content("supportMessage", "Support message"),
    line("supportLink", "Support link", "Footer"),
    line("signOff", "Sign-off", "Footer"),
    line("footerName", "Footer name", "Footer"),
    line("privacy", "Privacy policy", "Footer"),
    line("terms", "Terms and conditions", "Footer"),
    line("copyright", "Copyright", "Footer"),
  ],
  extended_warranty_reminder: [
    line("heading", "Heading", "Content"),
    line("heroBadgeWaiting", "Badge", "Content"),
    line("heroBadgeSoon", "Last-chance badge", "Content"),
    line("heroTitle", "Title", "Content", "Use {{product}} for the product name."),
    content("heroSubtitle", "Subtitle"),
    content("heroSubtitleWithDate", "Subtitle with date", "Use {{date}} for the warranty end date."),
    line("greeting", "Greeting", "Content", "Use {{name}} for the customer first name."),
    content("intro", "Introduction"),
    content("introWithDate", "Introduction with date", "Use {{date}} for the offer end date."),
    line("serialLabel", "Serial number label"),
    line("activeBadge", "Status badge"),
    line("expiresBadge", "Expiry badge", "Labels", "Use {{date}}."),
    line("plansTitle", "Plans heading"),
    line("coveragePrefix", "Coverage label"),
    line("extendButton", "Extend button"),
    line("coverageTitle", "Benefits heading"),
    line("offerCloses", "Offer closes", "Content", "Use {{date}}."),
    content("offerClosedAfter", "Offer closed text"),
    line("termsApply", "Terms link text"),
    line("expiryPill", "Expiry pill", "Content", "Use {{days}} and {{dayLabel}}."),
    line("daySingular", "Day"),
    line("dayPlural", "Days"),
    content("footerNotice", "Footer note"),
    line("continueShopping", "Continue shopping", "Footer"),
    content("supportMessage", "Support message"),
    line("supportLink", "Support link", "Footer"),
    line("signOff", "Sign-off", "Footer"),
    line("footerName", "Footer name", "Footer"),
    line("privacy", "Privacy policy", "Footer"),
    line("terms", "Terms and conditions", "Footer"),
    line("copyright", "Copyright", "Footer"),
  ],
  extended_warranty_refund_approved: [
    line("heading", "Heading", "Content"),
    line("heroBadge", "Badge", "Content"),
    line("heroTitle", "Title", "Content"),
    content("heroSubtitle", "Subtitle"),
    line("greeting", "Greeting", "Content", "Use {{name}} for the customer first name."),
    content("intro", "Introduction"),
    line("serialLabel", "Serial number label"),
    line("badge", "Status badge"),
    line("planLabel", "Plan label"),
    line("refundAmountLabel", "Refund amount label"),
    line("statusLabel", "Status label"),
    line("statusValue", "Status value"),
    line("processedDateLabel", "Processed date label"),
    line("buttonLabel", "Button"),
    content("footerNotice", "Footer note"),
    line("continueShopping", "Continue shopping", "Footer"),
    content("supportMessage", "Support message"),
    line("supportLink", "Support link", "Footer"),
    line("signOff", "Sign-off", "Footer"),
    line("footerName", "Footer name", "Footer"),
    line("privacy", "Privacy policy", "Footer"),
    line("terms", "Terms and conditions", "Footer"),
    line("copyright", "Copyright", "Footer"),
  ],
  extended_warranty_refund_rejected: [
    line("heading", "Heading", "Content"),
    line("heroBadge", "Badge", "Content"),
    line("heroTitle", "Title", "Content"),
    content("heroSubtitle", "Subtitle"),
    line("greeting", "Greeting", "Content", "Use {{name}} for the customer first name."),
    content("intro", "Introduction"),
    line("serialLabel", "Serial number label"),
    line("badge", "Status badge"),
    line("planLabel", "Plan label"),
    line("statusLabel", "Status label"),
    line("statusValue", "Status value"),
    line("decisionDateLabel", "Decision date label"),
    line("reasonLabel", "Reason label"),
    line("reasonFallback", "Reason fallback"),
    line("buttonLabel", "Button"),
    content("footerNotice", "Footer note"),
    line("continueShopping", "Continue shopping", "Footer"),
    content("supportMessage", "Support message"),
    line("supportLink", "Support link", "Footer"),
    line("signOff", "Sign-off", "Footer"),
    line("footerName", "Footer name", "Footer"),
    line("privacy", "Privacy policy", "Footer"),
    line("terms", "Terms and conditions", "Footer"),
    line("copyright", "Copyright", "Footer"),
  ],
};

const SHARED_EN = {
  greeting: "Hi {{name}},",
  serialLabel: "Serial number",
  continueShopping: "Continue shopping",
  supportMessage: "If you have any questions about extended coverage, our support team is happy to help.",
  supportLink: "Visit our support centre →",
  signOff: "The Sennheiser Hearing",
  footerName: "Sennheiser Hearing",
  privacy: "Privacy Policy",
  terms: "Terms & Conditions",
  copyright: "Sonova Consumer Hearing GmbH. All rights reserved.",
};

const EN_TEMPLATES = {
  standard_warranty: {
    subject: "Your Product Standard Warranty Registration is Completed.",
    heading: "Warranty Registration Successful!!!",
    intro: "Thank you for registering your product with us. We are pleased to confirm that your product is now registered successfully. Your product is now covered by the standard warranty, and you can view your warranty details below.",
    registeredBadge: "Standard Warranty Registered",
    expiresBadge: "Expires {{date}}",
    orderNumberLabel: "Order Number",
    registrationDateLabel: "Registration Date",
    purchaseDateLabel: "Purchase Date",
    warrantyExpiresLabel: "Warranty expires",
    buttonLabel: "View my warranty",
    purchaseNotice: "If the purchase date you registered differs from the actual purchase date, the warranty period will be determined based on the purchase date written on the proof of purchase. Please note that if you cannot provide proof of purchase, or if there are reasons that exclude the product from warranty coverage, we will not be able to accept your repair request under warranty, regardless of this registration.",
    freeWarrantyTitle: "FREE 1-Year Extended Warranty:",
    freeWarrantyBody: "Your product includes a FREE 1-year extended warranty.",
    preorderWarrantyBody: "Your product received a FREE 1-year extended warranty because it was purchased during the preorder offer.",
  },
  extended_warranty_purchase: {
    subject: "Extended Warranty Purchase Confirmation",
    heading: "Extended Warranty Purchase Confirmation",
    heroBadge: "Extended Warranty Active",
    heroTitle: "Your extended warranty is active",
    heroSubtitle: "Thank you for extending your coverage. Keep this email as your proof of coverage.",
    intro: "Thank you for purchasing extended warranty coverage for your registered product. Your extended warranty has been added to your product.",
    activeBadge: "Extended Warranty Active",
    orderNumberLabel: "Order number",
    planLabel: "Plan",
    amountPaidLabel: "Amount paid",
    coverageEndsLabel: "Coverage ends",
    buttonLabel: "View Product warranty",
    footerNotice: "This email confirms your extended warranty purchase. Please retain it for your records.",
  },
  extended_warranty_reminder: {
    subject: "Reminder: extend your warranty",
    heading: "Extended Warranty Offer Ending Soon",
    heroBadgeWaiting: "Your offer is waiting",
    heroBadgeSoon: "Last chance",
    heroTitle: "Protect your {{product}} beyond your standard warranty",
    heroSubtitle: "Extended coverage picks up exactly where your standard warranty ends — no gap, no overlap.",
    heroSubtitleWithDate: "Your standard warranty covers you until {{date}}. Extended coverage picks up exactly where it ends — no gap, no overlap.",
    intro: "When you registered your product, you chose to skip extended warranty coverage. That is completely fine — but your offer window is still open, and we wanted to make sure you had a chance to reconsider before it closes.",
    introWithDate: "When you registered your product, you chose to skip extended warranty coverage. That is completely fine — but your offer window is still open, and we wanted to make sure you had a chance to reconsider before it closes on {{date}}.",
    activeBadge: "Standard Warranty Active",
    expiresBadge: "Expires {{date}}",
    plansTitle: "Choose your Extended Coverage",
    coveragePrefix: "Coverage",
    extendButton: "Extend my warranty",
    coverageTitle: "What extended coverage includes",
    offerCloses: "This offer closes on {{date}}.",
    offerClosedAfter: "After this date, extended warranty will no longer be available for this product.",
    termsApply: "Terms & conditions apply.",
    expiryPill: "Extension Offer Expires in {{days}} {{dayLabel}}",
    daySingular: "Day",
    dayPlural: "Days",
    footerNotice: "You are receiving this email because you registered a Sennheiser product and have an active extended warranty offer.",
  },
  extended_warranty_refund_approved: {
    subject: "Extended Warranty Refund Approved",
    heading: "Extended Warranty Refund Approved",
    heroBadge: "Refund Approved",
    heroTitle: "Your refund has been approved",
    heroSubtitle: "We have processed your extended warranty refund request. Keep this email as your confirmation.",
    intro: "Your extended warranty refund request has been approved. Here are the details.",
    badge: "Refund Approved",
    planLabel: "Plan",
    refundAmountLabel: "Refund amount",
    statusLabel: "Status",
    statusValue: "Approved",
    processedDateLabel: "Processed date",
    buttonLabel: "View my warranty",
    footerNotice: "This email confirms your extended warranty refund approval. Please retain it for your records.",
  },
  extended_warranty_refund_rejected: {
    subject: "Extended Warranty Refund Request Update",
    heading: "Extended Warranty Refund Request Update",
    heroBadge: "Refund Update",
    heroTitle: "Your refund request was not approved",
    heroSubtitle: "We reviewed your extended warranty refund request and were unable to approve it at this time.",
    intro: "We were unable to approve your extended warranty refund request at this time. Below are the details of our decision.",
    badge: "Refund Not Approved",
    planLabel: "Plan",
    statusLabel: "Status",
    statusValue: "Not approved",
    decisionDateLabel: "Decision date",
    reasonLabel: "Reason",
    reasonFallback: "Not specified",
    buttonLabel: "View my warranty",
    footerNotice: "This email confirms the outcome of your extended warranty refund request. Please retain it for your records.",
  },
};

function pack(shared, templates) {
  return { shared, templates };
}

const TRANSLATIONS = {
  en: pack(SHARED_EN, EN_TEMPLATES),

};

export function getDefaultCopy(templateKey) {
  const english = TRANSLATIONS.en;
  return {
    ...(english.shared || {}),
    ...(english.templates?.[templateKey] || {}),
  };
}

export function resolveEmailCopy(templateKey, _languageCode, saved) {
  const defaults = getDefaultCopy(templateKey);
  const overlayValues = saved && typeof saved === "object" ? saved : {};
  const merged = { ...defaults };
  for (const [key, value] of Object.entries(overlayValues)) {
    if (value == null) continue;
    merged[key] = String(value);
  }
  return merged;
}
