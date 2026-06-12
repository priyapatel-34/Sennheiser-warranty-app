export default function ExtendedWarrantyActivationTemplate({
  customerName,
  productTitle,
  serialNumber,
  planName,
  activationDate,
  expiryDate,
  storeName,
}) {
  return `
    <div style="font-family: Arial, Helvetica, sans-serif; background:#f6f8fb; padding:40px 20px;">
      <div style="max-width:600px; margin:auto; background:#ffffff; padding:40px; border-radius:8px;">
        <h2 style="margin-top:0;">Extended Warranty Activated</h2>
        <p>Dear ${customerName || "Customer"},</p>
        <p>Your extended warranty coverage is now active.</p>
        <p>
          <strong>Product:</strong> ${productTitle}<br/>
          <strong>Serial Number:</strong> ${serialNumber}<br/>
          <strong>Plan:</strong> ${planName}<br/>
          <strong>Activation Date:</strong> ${activationDate}<br/>
          <strong>Expiry Date:</strong> ${expiryDate}<br/>
        </p>
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
