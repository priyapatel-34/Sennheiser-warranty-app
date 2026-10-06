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
  return String(customerName || "Customer").trim().split(/\s+/)[0];
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

export default function ExtendedWarrantyRefundRejectedTemplate({
  customerName,
  productTitle,
  planName,
  rejectionReason,
  productDetailsHtml = "",
  storeUrl,
  privacyUrl,
  termsUrl,
  supportUrl,
  serialNumber,
  processedDate,
  viewWarrantyUrl,
  copy = {},
}) {
  const bodyHtml = [
    renderGreeting({
      salutation: fillCopy(copyText(copy, "greeting", "Hi {{name}},"), { name: firstName(customerName) }),
      introHtml: plainToHtml(copyText(copy, "intro", "")),
    }),
    renderProductCard({
      productTitle,
      serialNumber,
      serialLabel: copyText(copy, "serialLabel", "Serial number"),
      badges: [{ label: copyText(copy, "badge", "Refund Not Approved"), tone: "warning" }],
    }),
    emailSection(`
      <table width="100%" cellspacing="0" cellpadding="0" style="width:100%;">
        <tbody>
          <tr><td height="24" style="height:24px;"></td></tr>
          <tr><td>${renderDetailsGrid([
            { label: copyText(copy, "planLabel", "Plan"), value: planName },
            { label: copyText(copy, "statusLabel", "Status"), value: copyText(copy, "statusValue", "Not approved") },
            { label: copyText(copy, "decisionDateLabel", "Decision date"), value: formatEmailDisplayDate(processedDate) },
            { label: copyText(copy, "reasonLabel", "Reason"), value: rejectionReason || copyText(copy, "reasonFallback", "Not specified") },
          ])}</td></tr>
        </tbody>
      </table>
    `),
    viewWarrantyUrl
      ? renderCtaBlock({ href: viewWarrantyUrl, label: copyText(copy, "buttonLabel", "View my warranty") })
      : productDetailsHtml
        ? emailSection(productDetailsHtml)
        : "",
  ].join("");

  return renderEmailLayout({
    heading: copyText(copy, "heading", "Extended Warranty Refund Request Update"),
    bodyHtml,
    storeName: copyText(copy, "footerName", "Sennheiser Hearing"),
    signOff: copyText(copy, "signOff", "The Sennheiser Hearing"),
    storeUrl,
    privacyUrl,
    termsUrl,
    supportUrl,
    labels: layoutLabels(copy),
    hero: {
      badge: copyText(copy, "heroBadge", "Refund Update"),
      title: copyText(copy, "heroTitle", "Your refund request was not approved"),
      subtitle: copyText(copy, "heroSubtitle", ""),
    },
    footerNotice: plainToHtml(copyText(copy, "footerNotice", "")),
  });
}
