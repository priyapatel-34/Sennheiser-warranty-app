export default function ExtendedWarrantyRefundApprovedTemplate({
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
        <h2 style="margin-top:0;">Extended Warranty Refund Approved</h2>
        <p>Dear ${customerName || "Customer"},</p>
        <p>Your extended warranty refund request has been approved.</p>
        <p>
          <strong>Product:</strong> ${productTitle}<br/>
          <strong>Plan:</strong> ${planName}<br/>
          <strong>Approved refund amount:</strong> ${refundAmount} ${currency || ""}<br/>
        </p>
        <p>Our finance team will process your reimbursement shortly. You will receive confirmation once the refund is completed.</p>
        <p style="margin-top:30px;">
          Kind regards,<br/>
          <strong>${storeName || "Sennheiser Team"}</strong>
        </p>
      </div>
    </div>
  `;
}
