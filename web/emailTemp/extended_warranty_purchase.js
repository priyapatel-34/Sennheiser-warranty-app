export default function ExtendedWarrantyPurchaseTemplate({
  customerName,
  productTitle,
  orderNumber,
  planName,
  durationMonths,
  price,
  currency,
  storeName,
}) {
  return `
    <div style="font-family: Arial, Helvetica, sans-serif; background:#f6f8fb; padding:40px 20px;">
      <div style="max-width:600px; margin:auto; background:#ffffff; padding:40px; border-radius:8px;">
        <h2 style="margin-top:0;">Extended Warranty Purchase Confirmation</h2>
        <p>Dear ${customerName || "Customer"},</p>
        <p>Thank you for purchasing extended warranty coverage for your registered product.</p>
        <p>
          <strong>Product:</strong> ${productTitle}<br/>
          ${orderNumber ? `<strong>Order Number:</strong> ${orderNumber}<br/>` : ""}
          <strong>Plan:</strong> ${planName}<br/>
          <strong>Duration:</strong> ${durationMonths} months<br/>
          <strong>Amount Paid:</strong> ${price} ${currency}<br/>
        </p>
        <p>Your extended warranty will be activated upon payment confirmation.</p>
        <p>
           Please keep this email for your records. It serves as confirmation
           of your warranty registration.
        </p>

        <p>
          If you require any assistance, our support team will be happy to help.
        </p>

        <p style="margin-top:30px;">
          Kind regards,<br/>
          <strong>Sonova Team</strong>
        </p>
      </div>
    </div>
  `;
}
