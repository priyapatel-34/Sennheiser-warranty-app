import { renderEmailLayout } from "./_layout.js";

export default function ExtendedWarrantyRefundApprovedTemplate({
  customerName,
  productTitle,
  planName,
  refundAmount,
  currency,
  storeName,
  productDetailsHtml = "",
}) {
  const bodyHtml = `
    <p>Dear ${customerName || "Customer"},</p><br/>
    <p>Your extended warranty refund request has been approved.</p><br/>
    <p>
      <strong>Product:</strong> ${productTitle}<br/>
      <strong>Plan:</strong> ${planName}<br/>
      <strong>Approved refund amount:</strong> ${refundAmount} ${currency || ""}<br/>
    </p>
    ${productDetailsHtml}
     <br/>
  `;

  return renderEmailLayout({
    heading: "Extended Warranty Refund Approved",
    bodyHtml,
    storeName: "Sonova Team",
  });
}
