import {
  renderEmailLayout,
  renderGreeting,
  renderProductCard,
  renderDetailsGrid,
  renderCtaBlock,
  emailSection,
  formatEmailDisplayDate,
} from "./_layout.js";
import { copyText, fillCopy, fillPlain, plainToHtml } from "../services/emailCopyCatalog.js";

function firstName(customerName) {
  return String(customerName || "Customer")
    .trim()
    .split(/\s+/)[0];
}

/**
 * Standard-warranty confirmation. Static sentences and labels come from the
 * shop's language copy. Names, serials, dates, and order data stay generated.
 */
export default function WarrantyRegistrationSuccessTemplate({
  customerName,
  productTitle,
  purchaseDate,
  serialNumber,
  productDetailsHtml = "",
  hasFreeExtendedWarranty = false,
  freeExtendedWarrantySource = null,
  registrationDate,
  orderNumber,
  warrantyExpiry,
  viewWarrantyUrl,
  storeUrl = "",
  privacyUrl = "",
  termsUrl = "",
  supportUrl = "",
  copy = {},
}) {
  const heading = copyText(copy, "heading", "Warranty Registration Successful!!!");
  const expiryDisplay = formatEmailDisplayDate(warrantyExpiry);
  const freeWarrantyCopy =
    freeExtendedWarrantySource === "preorder_offer"
      ? copyText(
          copy,
          "preorderWarrantyBody",
          "Your product received a FREE 1-year extended warranty because it was purchased during the preorder offer."
        )
      : copyText(copy, "freeWarrantyBody", "Your product includes a FREE 1-year extended warranty.");

  const details = renderDetailsGrid([
    { label: copyText(copy, "orderNumberLabel", "Order Number"), value: orderNumber || "—" },
    { label: copyText(copy, "registrationDateLabel", "Registration Date"), value: formatEmailDisplayDate(registrationDate) },
    { label: copyText(copy, "purchaseDateLabel", "Purchase Date"), value: formatEmailDisplayDate(purchaseDate) },
    { label: copyText(copy, "warrantyExpiresLabel", "Warranty expires"), value: expiryDisplay },
  ]);

  const purchaseNotice = copyText(copy, "purchaseNotice", "");
  const bodyHtml = [
    renderGreeting({
      salutation: fillCopy(copyText(copy, "greeting", "Hi {{name}},"), {
        name: firstName(customerName),
      }),
      introHtml: plainToHtml(copyText(copy, "intro", "")),
    }),
    renderProductCard({
      productTitle,
      serialNumber,
      serialLabel: copyText(copy, "serialLabel", "Serial number"),
      badges: [
        { label: copyText(copy, "registeredBadge", "Standard Warranty Registered") },
        expiryDisplay
          ? { label: fillPlain(copyText(copy, "expiresBadge", "Expires {{date}}"), { date: expiryDisplay }), tone: "warning" }
          : null,
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
            <strong>${plainToHtml(copyText(copy, "freeWarrantyTitle", "FREE 1-Year Extended Warranty:"))}</strong> ${plainToHtml(freeWarrantyCopy)}
          </p>
        `)
      : "",
    viewWarrantyUrl
      ? renderCtaBlock({
          href: viewWarrantyUrl,
          label: copyText(copy, "buttonLabel", "View my warranty"),
        })
      : productDetailsHtml
        ? emailSection(productDetailsHtml)
        : "",
  ].join("");

  return renderEmailLayout({
    heading,
    bodyHtml,
    storeName: copyText(copy, "footerName", "Sennheiser Hearing"),
    signOff: copyText(copy, "signOff", "The Sennheiser Hearing"),
    storeUrl,
    privacyUrl,
    termsUrl,
    supportUrl,
    additionalContentHtml: purchaseNotice
      ? `<p style="font-size:12px; line-height:1.6; color:#000000; margin:0;">${plainToHtml(purchaseNotice)}</p>`
      : "",
    labels: {
      continueShopping: copyText(copy, "continueShopping", "Continue shopping"),
      supportMessage: copyText(copy, "supportMessage", ""),
      supportLink: copyText(copy, "supportLink", "Visit our support centre →"),
      privacy: copyText(copy, "privacy", "Privacy Policy"),
      terms: copyText(copy, "terms", "Terms & Conditions"),
      copyright: copyText(copy, "copyright", "Sonova Consumer Hearing GmbH. All rights reserved."),
    },
  });
}
