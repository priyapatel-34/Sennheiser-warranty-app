export default function ExtendedWarrantyRefundRejectedTemplate({
  customerName,
  productTitle,
  planName,
  rejectionReason,
  storeName,
}) {
  return `
    <div style="font-family: Arial, Helvetica, sans-serif; background:#f6f8fb; padding:40px 20px;">
      <div style="max-width:600px; margin:auto; background:#ffffff; padding:40px; border-radius:8px;">
        <h2 style="margin-top:0;">Extended Warranty Refund Request Update</h2>
        <p>Dear ${customerName || "Customer"},</p>
        <p>We were unable to approve your extended warranty refund request at this time.</p>
        <p>
          <strong>Product:</strong> ${productTitle}<br/>
          <strong>Plan:</strong> ${planName}<br/>
          ${rejectionReason ? `<strong>Reason:</strong> ${rejectionReason}<br/>` : ""}
        </p>
        <p>If you have questions, please contact our support team.</p>
        <p style="margin-top:30px;">
          Kind regards,<br/>
          <strong>${storeName || "Sennheiser Team"}</strong>
        </p>
      </div>
    </div>
  `;
}
