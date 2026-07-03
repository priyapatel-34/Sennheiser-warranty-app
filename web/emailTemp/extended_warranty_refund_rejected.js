import { renderEmailLayout } from "./_layout.js";

export default function ExtendedWarrantyRefundRejectedTemplate({
  customerName,
  productTitle,
  planName,
  rejectionReason,
  storeName,
  productDetailsHtml = "",
}) {
  const bodyHtml = `
    <p>Dear ${customerName || "Customer"},</p><br/>
    <p>We were unable to approve your extended warranty refund request at this time.</p><br/>
    <p>
      <strong>Product:</strong> ${productTitle}<br/>
      <strong>Plan:</strong> ${planName}<br/>
      ${rejectionReason ? `<strong>Reason:</strong> ${rejectionReason}<br/>` : ""}
    </p>
    ${productDetailsHtml}
     <br/>
  `;

  return renderEmailLayout({
    heading: "Extended Warranty Refund Request Update",
    bodyHtml,
    storeName: "Sonova Team",
  });
}
