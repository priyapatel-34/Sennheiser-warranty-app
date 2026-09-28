import {
  renderEmailLayout,
  renderGreeting,
  renderProductCard,
  renderDetailsGrid,
  renderCtaBlock,
  emailSection,
  escapeHtml,
  formatEmailDisplayDate,
} from "./_layout.js";

function normalizeShopDomain(shopDomain) {
  return String(shopDomain || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/$/, "")
    .replace(/^www\./i, "")
    .toLowerCase();
}

function isJapanStoreDomain(shopDomain) {
  return normalizeShopDomain(shopDomain) === "jp.sennheiser-hearing.com";
}

function isIndiaStoreDomain(shopDomain) {
  return normalizeShopDomain(shopDomain) === "in.sennheiser-hearing.com";
}

function firstName(customerName) {
  return String(customerName || "Customer")
    .trim()
    .split(/\s+/)[0];
}

/**
 * English standard-warranty confirmation in the shared card layout.
 *
 * Japan store uses a different heading.
 * India store uses India-specific sign-off/footer behavior.
 */
export default function WarrantyRegistrationSuccessTemplate({
  customerName,
  productTitle,
  purchaseDate,
  serialNumber,
  productDetailsHtml = "",
  shopDomain,
  shopifyShop,
  hasFreeExtendedWarranty = false,
  freeExtendedWarrantySource = null,
  registrationDate,
  warrantyStartDate,
  orderNumber,
  warrantyExpiry,
  viewWarrantyUrl,
  storeUrl = "",
  privacyUrl = "",
  termsUrl = "",
  supportUrl = "",
}) {
  const isJapanStore =
    isJapanStoreDomain(shopDomain) ||
    isJapanStoreDomain(shopifyShop);

  const isIndiaStore =
    isIndiaStoreDomain(shopDomain) ||
    isIndiaStoreDomain(shopifyShop);

  const heading = isJapanStore
    ? "Product Registration Successful!!!"
    : "Warranty Registration Successful!!!";

  const registeredBadge = isJapanStore
    ? "Product Registered"
    : "Standard Warranty Registered";

  const warrantyButtonLabel = isJapanStore
    ? "View Product Details"
    : "View my warranty";

  const registrationIntro = isJapanStore
  ? "Thank you for registering your product with us. We are pleased to confirm that your product is now registered successfully."
  : "Thank you for registering your product with us. We are pleased to confirm that your product is now registered successfully. Your product is now covered by the standard warranty, and you can view your warranty details below.";

  const expiryDisplay = formatEmailDisplayDate(warrantyExpiry);
  const freeWarrantyCopy =
    freeExtendedWarrantySource === "preorder_offer"
      ? "Your product received a FREE 1-year extended warranty because it was purchased during the preorder offer."
      : "Your product includes a FREE 1-year extended warranty.";

  const details = renderDetailsGrid([
    { label: "Order Number", value: orderNumber || "—" },
    { label: "Registration Date", value: formatEmailDisplayDate(registrationDate) },
    { label: "Purchase Date", value: formatEmailDisplayDate(purchaseDate) },
    { label: "Warranty expires", value: expiryDisplay },
  ]);

  const bodyHtml = [
    renderGreeting({
      name: firstName(customerName),
      introHtml: registrationIntro,
      }),
    renderProductCard({
      productTitle,
      serialNumber,
      badges: [
        { label: registeredBadge },
        expiryDisplay ? { label: `Expires ${expiryDisplay}`, tone: "warning" } : null,
      ].filter(Boolean),
    }),
    emailSection(`
      <table width="100%" cellspacing="0" cellpadding="0" style="width:100%;">
        <tbody>
          <tr><td class="h-24" height="24" style="height:24px;"></td></tr>
          <tr><td>${details}</td></tr>
        </tbody>
      </table>
    `),
    hasFreeExtendedWarranty
      ? emailSection(`
          <p style="font-size:14px; font-weight:400; line-height:1.5; color:#000000; margin:16px 0 0;">
            <strong>FREE 1-Year Extended Warranty:</strong> ${escapeHtml(freeWarrantyCopy)}
          </p>
        `)
      : "",
    viewWarrantyUrl
      ? renderCtaBlock({ href: viewWarrantyUrl, label: warrantyButtonLabel })
      : productDetailsHtml
        ? emailSection(productDetailsHtml)
        : "",
  ].join("");

  return renderEmailLayout({
    heading,
    bodyHtml,
    storeName: isIndiaStore ? "" : "Sennheiser Hearing",
    signOff: isIndiaStore
      ? "Best Regards, Sennheiser India Team"
      : "The Sennheiser Hearing",
    storeUrl,
    privacyUrl,
    termsUrl,
    supportUrl,
    labels: {
      continueShopping: "Continue shopping",
    },
    hideFooterStoreName: isIndiaStore,
  });
}
