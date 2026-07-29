import { renderEmailLayout, emailButton } from "./_layout.js";

export default function ExtendedWarrantyEligibilityReminderTemplate({
  customerName,
  productTitle,
  serialNumber,
  daysRemaining,
  eligibilityEndDate,
  extendWarrantyUrl,
  productDetailsHtml = "",
  storeName,
}) {
  const dayLabel = daysRemaining === 1 ? "day" : "days";

  const bodyHtml = `
    <p>Dear ${customerName || "Customer"},</p><br/>
    <p>
      You have <strong>${daysRemaining} ${dayLabel}</strong> left to purchase extended warranty
      coverage for your registered product.
    </p><br/>
    <p>
      <strong>Product:</strong> ${productTitle}<br/>
      ${serialNumber ? `<strong>Serial Number:</strong> ${serialNumber}<br/>` : ""}
      ${eligibilityEndDate ? `<strong>Offer ends:</strong> ${eligibilityEndDate}<br/>` : ""}
    </p><br/>
    <p>
      ${emailButton({ href: extendWarrantyUrl, label: "Extend Warranty Now" })}
    </p>
    ${productDetailsHtml}
  `;

  return renderEmailLayout({
    heading: "Extended Warranty Offer Ending Soon",
    bodyHtml,
    storeName: "Sonova Team",
  });
}