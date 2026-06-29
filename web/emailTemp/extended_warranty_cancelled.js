export default function ExtendedWarrantyCancelledTemplate({
  customerName,
  productTitle,
  serialNumber,
  planName,
  storeName = "Sennheiser",
}) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Extended Warranty Cancelled</h2>
      <p>Hello ${customerName || "Customer"},</p>
      <p>Your extended warranty for <strong>${productTitle}</strong> has been cancelled.</p>
      <ul>
        <li><strong>Plan:</strong> ${planName || "Extended Warranty"}</li>
        ${serialNumber ? `<li><strong>Serial:</strong> ${serialNumber}</li>` : ""}
      </ul>
      <p>If a refund is due, our finance team will process it separately. You will receive another email when the refund amount is calculated.</p>
      <p>Thank you,<br/>${storeName}</p>
    </div>
  `;
}
