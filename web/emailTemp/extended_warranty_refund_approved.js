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
    <p>Dear ${customerName || "Customer"},</p>
    <p>Your extended warranty refund request has been approved.</p>
    <p>
      <strong>Product:</strong> ${productTitle}<br/>
      <strong>Plan:</strong> ${planName}<br/>
      <strong>Approved refund amount:</strong> ${refundAmount} ${currency || ""}<br/>
    </p>
    <p>Our finance team will process your reimbursement shortly. You will receive confirmation once the refund is completed.</p>
    ${productDetailsHtml}
  `;

  return renderEmailLayout({
    heading: "Extended Warranty Refund Approved",
    bodyHtml,
    storeName: storeName || "Sennheiser Team",
  });
}
