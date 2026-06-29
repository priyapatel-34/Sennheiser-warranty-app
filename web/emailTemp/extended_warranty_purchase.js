import { renderEmailLayout } from "./_layout.js";

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
  const bodyHtml = `
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
  `;

  return renderEmailLayout({
    heading: "Extended Warranty Purchase Confirmation",
    bodyHtml,
    storeName: "Sonova Team",
  });
}
