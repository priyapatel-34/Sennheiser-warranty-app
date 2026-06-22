export default function ExtendedWarrantyEligibilityReminderTemplate({
  customerName,
  productTitle,
  serialNumber,
  daysRemaining,
  eligibilityEndDate,
  extendWarrantyUrl,
  storeName,
}) {
  const dayLabel = daysRemaining === 1 ? "day" : "days";

  return `
    <div style="font-family: Arial, Helvetica, sans-serif; background:#f6f8fb; padding:40px 20px;">
      <div style="max-width:600px; margin:auto; background:#ffffff; padding:40px; border-radius:8px;">
        <h2 style="margin-top:0;">Extended Warranty Offer Ending Soon</h2>
        <p>Dear ${customerName || "Customer"},</p>
        <p>
          You have <strong>${daysRemaining} ${dayLabel}</strong> left to purchase extended warranty
          coverage for your registered product.
        </p>
        <p>
          <strong>Product:</strong> ${productTitle}<br/>
          ${serialNumber ? `<strong>Serial Number:</strong> ${serialNumber}<br/>` : ""}
          ${eligibilityEndDate ? `<strong>Offer ends:</strong> ${eligibilityEndDate}<br/>` : ""}
        </p>
        <p>
          <a href="${extendWarrantyUrl}" style="display:inline-block; background:#000; color:#fff; padding:12px 24px; text-decoration:none; border-radius:4px; font-weight:bold;">
            Extend Warranty Now
          </a>
        </p>
        <p style="margin-top:30px;">
          Kind regards,<br/>
          <strong>${storeName || "Sonova Team"}</strong>
        </p>
      </div>
    </div>
  `;
}
