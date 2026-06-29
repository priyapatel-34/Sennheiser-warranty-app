import { renderEmailLayout } from "./_layout.js";

export default function WarrantyRegistrationSuccessTemplate({
  customerName,
  productTitle,
  orderNumber,
  warrantyPeriod,
}) {
  const bodyHtml = `
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
  `;

  return renderEmailLayout({
    heading: "Warranty Registration Successful!!!",
    bodyHtml,
    storeName: "Sonova Team",
  });
}
