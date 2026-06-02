export default function WarrantyRegistrationSuccessTemplate({
  customerName,
  productTitle,
  orderNumber,
  warrantyPeriod,
}) {
  return `
    <div style="font-family: Arial, Helvetica, sans-serif; background:#f6f8fb; padding:40px 20px;">
      <div style="max-width:600px; margin:auto; background:#ffffff; padding:40px; border-radius:8px;">

        <h2 margin-top:0;">
          Warranty Registration Successful!!!
        </h2>

        <p>Dear ${customerName || "Customer"},</p>

        <p>
          Thank you for registering your product with us. We are pleased to confirm
          that your warranty has been successfully activated.
        </p>

        <p>
          <strong>Product:</strong> ${productTitle}<br/>
          ${orderNumber && orderNumber !== "N/A" ? `<strong>Order Number:</strong> ${orderNumber}<br/>` : ""}
          <strong>Warranty Period:</strong> ${warrantyPeriod}<br/>
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
