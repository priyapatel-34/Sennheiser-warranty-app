import {
  renderEmailLayout,
  renderGreeting,
  renderProductCard,
  renderDetailsGrid,
  renderCtaBlock,
  emailSection,
  formatEmailDisplayDate,
} from "./_layout.js";
import { copyText, fillCopy, plainToHtml } from "../services/emailCopyCatalog.js";

function firstName(customerName) {
  return String(customerName || "Customer")
    .trim()
    .split(/\s+/)[0];
}

function layoutLabels(copy) {
  return {
    continueShopping: copyText(copy, "continueShopping", "Continue shopping"),
    supportMessage: copyText(copy, "supportMessage", ""),
    supportLink: copyText(copy, "supportLink", "Visit our support centre →"),
    privacy: copyText(copy, "privacy", "Privacy Policy"),
    terms: copyText(copy, "terms", "Terms & Conditions"),
    copyright: copyText(copy, "copyright", "Sonova Consumer Hearing GmbH. All rights reserved."),
  };
}

export default function ExtendedWarrantyPurchaseTemplate({
  customerName,
  productTitle,
  orderNumber,
  planName,
  price,
  currency,
  serialNumber,
  expiryDate,
  productDetailsHtml = "",
  storeUrl,
  privacyUrl,
  termsUrl,
  supportUrl,
  viewWarrantyUrl,
  copy = {},
}) {
  const amountPaid = [price, currency].filter(Boolean).join(" ");
  const details = renderDetailsGrid([
    { label: copyText(copy, "orderNumberLabel", "Order number"), value: orderNumber },
    { label: copyText(copy, "planLabel", "Plan"), value: planName },
    { label: copyText(copy, "amountPaidLabel", "Amount paid"), value: amountPaid },
    { label: copyText(copy, "coverageEndsLabel", "Coverage ends"), value: formatEmailDisplayDate(expiryDate) },
  ]);

  const bodyHtml = [
    renderGreeting({
      salutation: fillCopy(copyText(copy, "greeting", "Hi {{name}},"), { name: firstName(customerName) }),
      introHtml: plainToHtml(copyText(copy, "intro", "")),
    }),
    renderProductCard({
      productTitle,
      serialNumber,
      serialLabel: copyText(copy, "serialLabel", "Serial number"),
      badges: [
        { label: copyText(copy, "activeBadge", "Extended Warranty Active") },
        planName ? { label: planName } : null,
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
    viewWarrantyUrl
      ? renderCtaBlock({ href: viewWarrantyUrl, label: copyText(copy, "buttonLabel", "View Product warranty") })
      : productDetailsHtml
        ? emailSection(productDetailsHtml)
        : "",
  ].join("");

  return renderEmailLayout({
    heading: copyText(copy, "heading", "Extended Warranty Purchase Confirmation"),
    bodyHtml,
    storeName: copyText(copy, "footerName", "Sennheiser Hearing"),
    signOff: copyText(copy, "signOff", "The Sennheiser Hearing"),
    storeUrl,
    privacyUrl,
    termsUrl,
    supportUrl,
    labels: layoutLabels(copy),
    hero: {
      badge: copyText(copy, "heroBadge", "Extended Warranty Active"),
      title: copyText(copy, "heroTitle", "Your extended warranty is active"),
      subtitle: copyText(copy, "heroSubtitle", ""),
    },
    footerNotice: plainToHtml(copyText(copy, "footerNotice", "")),
  });
}
