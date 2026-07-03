import { renderEmailLayout } from "./_layout.js";

export default function WarrantyRegistrationSuccessTemplate({
  customerName,
  productTitle,
  orderNumber,
  purchaseDate,
  warrantyPeriod,
  productDetailsHtml = "",
}) {
  const bodyHtml = `
    <p>Dear ${customerName || "Customer"},</p>

    <p>
      Thank you for registering your product with us. We are pleased to confirm
      that your warranty has been successfully activated.
    </p>
    </br>
    <p>
      <strong>Product:</strong> ${productTitle}<br/>
      ${orderNumber && orderNumber !== "N/A" ? `<strong>Order Number:</strong> ${orderNumber}<br/>` : ""}
      ${purchaseDate ? `<strong>Purchase Date:</strong> ${purchaseDate}<br/>` : ""}
      <strong>Warranty Period:</strong> ${warrantyPeriod}<br/>
    </p>

    ${productDetailsHtml}
 <br/>
  `;

  return renderEmailLayout({
    heading: "Warranty Registration Successful!!!",
    bodyHtml,
    storeName: "Sonova Team",
  });
}
