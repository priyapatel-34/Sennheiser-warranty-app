export default function ExtendedWarrantyRefundCalculatedTemplate({
  customerName,
  productTitle,
  planName,
  refundAmount,
  currency,
  storeName = "Sennheiser",
}) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Extended Warranty Refund Calculated</h2>
      <p>Hello ${customerName || "Customer"},</p>
      <p>We have calculated a refund for your extended warranty on <strong>${productTitle}</strong>.</p>
      <ul>
        <li><strong>Plan:</strong> ${planName || "Extended Warranty"}</li>
        <li><strong>Refund amount:</strong> ${refundAmount} ${currency || ""}</li>
      </ul>
      <p>Our finance team will review and process this refund manually. No automatic refund has been issued to your payment method.</p>
      <p>Thank you,<br/>${storeName}</p>
    </div>
  `;
}
