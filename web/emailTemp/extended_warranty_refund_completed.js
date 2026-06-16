export default function ExtendedWarrantyRefundCompletedTemplate({
  customerName,
  productTitle,
  planName,
  refundAmount,
  currency,
  storeName,
}) {
  return `
    <div style="font-family: Arial, Helvetica, sans-serif; background:#f6f8fb; padding:40px 20px;">
      <div style="max-width:600px; margin:auto; background:#ffffff; padding:40px; border-radius:8px;">
        <h2 style="margin-top:0;">Extended Warranty Refund Processed</h2>
        <p>Dear ${customerName || "Customer"},</p>
        <p>Your extended warranty refund has been processed by our finance team.</p>
        <p>
          <strong>Product:</strong> ${productTitle}<br/>
          <strong>Plan:</strong> ${planName}<br/>
          <strong>Refund amount:</strong> ${refundAmount} ${currency || ""}<br/>
        </p>
        <p>Please allow a few business days for the reimbursement to appear on your original payment method, depending on your bank or card provider.</p>
        <p style="margin-top:30px;">
          Kind regards,<br/>
          <strong>${storeName || "Sennheiser Team"}</strong>
        </p>
      </div>
    </div>
  `;
}
