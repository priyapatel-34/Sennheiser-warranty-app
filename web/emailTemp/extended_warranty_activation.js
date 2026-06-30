import { renderEmailLayout } from "./_layout.js";

export default function ExtendedWarrantyActivationTemplate({
  customerName,
  productTitle,
  serialNumber,
  planName,
  activationDate,
  expiryDate,
  productDetailsHtml = "",
}) {
  const bodyHtml = `
    <p>Dear ${customerName || "Customer"},</p>
    <p>Your extended warranty coverage is now active.</p>
    <p>
      <strong>Product:</strong> ${productTitle}<br/>
      <strong>Serial Number:</strong> ${serialNumber}<br/>
      <strong>Plan:</strong> ${planName}<br/>
      <strong>Activation Date:</strong> ${activationDate}<br/>
      <strong>Expiry Date:</strong> ${expiryDate}<br/>
    </p>
    ${productDetailsHtml}
    <p>
       Please keep this email for your records. It serves as confirmation
       of your warranty registration.
    </p>

    <p>
      If you require any assistance, our support team will be happy to help.
    </p>
  `;

  return renderEmailLayout({
    heading: "Extended Warranty Activated",
    bodyHtml,
    storeName: "Sonova Team",
  });
}
