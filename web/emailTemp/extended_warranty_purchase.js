import { renderEmailLayout } from "./_layout.js";

export default function ExtendedWarrantyPurchaseTemplate({
  customerName,
  productTitle,
  orderNumber,
  planName,
  durationMonths,
  price,
  currency,
  serialNumber,
  activationDate,
  expiryDate,
  productDetailsHtml = "",
}) {
  const bodyHtml = `
    <p>Dear ${customerName || "Customer"},</p><br/>
    <p>Thank you for purchasing extended warranty coverage for your registered product.</p><br/>
    <p>
      <strong>Product:</strong> ${productTitle}<br/>
      ${orderNumber ? `<strong>Order Number:</strong> ${orderNumber}<br/>` : ""}
      ${serialNumber ? `<strong>Serial Number:</strong> ${serialNumber}<br/>` : ""}
      <strong>Plan:</strong> ${planName}<br/>
      <strong>Duration:</strong> ${durationMonths} months<br/>
      <strong>Amount Paid:</strong> ${price} ${currency}<br/>
      ${activationDate ? `<strong>Coverage starts:</strong> ${activationDate}<br/>` : ""}
      ${expiryDate ? `<strong>Coverage ends:</strong> ${expiryDate}<br/>` : ""}
    </p>
  <br/>
    ${productDetailsHtml}
     <br/>
  `;

  return renderEmailLayout({
    heading: "Extended Warranty Purchase Confirmation",
    bodyHtml,
    storeName: "Sonova Team",
  });
}
