export default function ExtendedWarrantyRefundCreatedTemplate({
  customerName,
  productTitle,
  serialNumber,
  planName,
  refundAmount,
  currency,
  storeName,
}) {
  return `
    <div style="font-family: Arial, Helvetica, sans-serif; background:#f6f8fb; padding:40px 20px;">
      <div style="max-width:600px; margin:auto; background:#ffffff; padding:40px; border-radius:8px;">
        <h2 style="margin-top:0;">Extended Warranty Refund Request Received</h2>
        <p>Dear ${customerName || "Customer"},</p>
        <p>We have received your extended warranty refund request and our finance team is reviewing it.</p>
        <p>
          <strong>Product:</strong> ${productTitle}<br/>
          <strong>Serial Number:</strong> ${serialNumber || "—"}<br/>
          <strong>Plan:</strong> ${planName}<br/>
          <strong>Estimated refund:</strong> ${refundAmount} ${currency || ""}<br/>
        </p>
        <p>You will receive another email once your request has been processed.</p>
        <p style="margin-top:30px;">
          Kind regards,<br/>
          <strong>${storeName || "Sennheiser Team"}</strong>
        </p>
      </div>
    </div>
  `;
}
