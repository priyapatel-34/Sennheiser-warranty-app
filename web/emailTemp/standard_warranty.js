import { renderEmailLayout } from "./_layout.js";

/**
 * Renders the standard-warranty confirmation email shown after a successful
 * registration completes.
 */
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


// import { escapeHtml, renderAdditionalNotesHtml } from "./_layout.js";

// /**
//  * Fixed Standard Warranty Registration email — matches the approved
//  * "Warranty Registration Confirmed" design exactly. Layout/branding are not
//  * merchant-editable; only `additionalNotes` (set in Email Settings) varies.
//  *
//  * `orderNumber` / `warrantyPeriod` are accepted for data continuity (sample
//  * data, future use) but are intentionally not rendered — the approved design
//  * does not include an order-number or duration-text field.
//  */
// export default function WarrantyRegistrationSuccessTemplate({
//   customerName,
//   productTitle,
//   serialNumber,
//   registrationDate,
//   purchaseDate,
//   warrantyStartDate,
//   warrantyExpiry,
//   myProductsUrl,
//   shopUrl,
//   supportUrl,
//   privacyUrl,
//   termsUrl,
//   additionalNotes = "",
// }) {
//   const firstName = String(customerName || "Customer").trim().split(/\s+/)[0];

//   return `
// <!DOCTYPE html>
// <html lang="en">
// <head>
// <meta charset="UTF-8">
// <meta name="viewport" content="width=device-width, initial-scale=1.0">
// <title>Warranty Registration Confirmed</title>
// <style>
//   * { margin: 0; padding: 0; box-sizing: border-box; }
//   body { background-color: #F4F6F8; font-family: Arial, sans-serif; }
//   .wrapper { max-width: 600px; margin: 32px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
//   .header { background-color: #1F4E79; padding: 32px 40px 28px; }
//   .header-wordmark { color: #ffffff; font-size: 20px; font-weight: 700; letter-spacing: 0.04em; }
//   .hero { background-color: #1F4E79; padding: 0 40px 36px; border-bottom: 4px solid #C9A84C; }
//   .hero-label { display: inline-block; background: #C9A84C; color: #ffffff; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; padding: 4px 12px; border-radius: 20px; margin-bottom: 16px; }
//   .hero h1 { color: #ffffff; font-size: 26px; font-weight: 700; line-height: 1.3; }
//   .hero p { color: #B8D0E8; font-size: 14px; margin-top: 8px; line-height: 1.6; }
//   .body { padding: 36px 40px; }
//   .greeting { font-size: 15px; color: #334155; margin-bottom: 20px; line-height: 1.6; }
//   .product-card { background: #F4F8FC; border: 1px solid #D4E4F5; border-radius: 8px; padding: 20px 24px; margin-bottom: 28px; display: flex; gap: 20px; align-items: flex-start; }
//   .product-card .product-info { flex: 1; }
//   .product-card .product-name { font-size: 17px; font-weight: 700; color: #1F4E79; margin-bottom: 4px; }
//   .product-card .serial { font-size: 12px; color: #64748B; margin-bottom: 12px; }
//   .product-card .serial span { font-weight: 600; color: #334155; }
//   .warranty-row { display: flex; gap: 8px; margin-top: 4px; }
//   .warranty-badge { background: #E2F5EF; color: #0D7A5F; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 20px; }
//   .details-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin-bottom: 28px; border: 1px solid #E2E8F0; border-radius: 8px; overflow: hidden; }
//   .detail-cell { padding: 14px 18px; border-bottom: 1px solid #E2E8F0; border-right: 1px solid #E2E8F0; }
//   .detail-cell:nth-child(even) { border-right: none; }
//   .detail-cell:nth-last-child(-n+2) { border-bottom: none; }
//   .detail-label { font-size: 11px; color: #94A3B8; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 4px; }
//   .detail-value { font-size: 14px; color: #1E293B; font-weight: 600; }
//   .cta-block { text-align: center; margin: 28px 0; }
//   .cta-primary { display: inline-block; background: #1F4E79; color: #ffffff; font-size: 14px; font-weight: 700; padding: 14px 32px; border-radius: 6px; text-decoration: none; letter-spacing: 0.02em; }
//   .cta-secondary { display: block; margin-top: 12px; font-size: 13px; color: #2E75B6; text-decoration: underline; }
//   .divider { border: none; border-top: 1px solid #E2E8F0; margin: 28px 0; }
//   .support-block { background: #F8FAFC; border-left: 4px solid #2E75B6; border-radius: 0 6px 6px 0; padding: 16px 20px; margin-bottom: 28px; }
//   .support-block p { font-size: 13px; color: #475569; line-height: 1.6; }
//   .support-block a { color: #2E75B6; font-weight: 600; }
//   .sign-off { font-size: 14px; color: #334155; line-height: 1.7; }
//   .sign-off strong { color: #1F4E79; }
//   .footer { background: #1A2F45; padding: 24px 40px; }
//   .footer p { font-size: 11px; color: #7A9BB5; line-height: 1.7; }
//   .footer a { color: #9CB8D4; text-decoration: none; }
//   .footer .footer-brand { font-size: 13px; color: #9CB8D4; font-weight: 700; margin-bottom: 8px; }
//   @media (max-width: 480px) {
//     .body { padding: 24px 20px; }
//     .hero { padding: 0 20px 28px; }
//     .header { padding: 24px 20px 20px; }
//     .details-grid { grid-template-columns: 1fr; }
//     .detail-cell:nth-child(even) { border-right: none; }
//     .detail-cell { border-right: none !important; }
//     .detail-cell:last-child { border-bottom: none; }
//     .product-card { flex-direction: column; }
//   }
// </style>
// </head>
// <body>
// <div class="wrapper">

//   <div class="header">
//     <div class="header-wordmark">SENNHEISER</div>
//   </div>

//   <div class="hero">
//     <div style="padding-top: 24px;">
//       <div class="hero-label">✓ WARRANTY CONFIRMED</div>
//       <h1>Your warranty is registered</h1>
//       <p>We have received your registration and your product is now covered.<br>Keep this email as your proof of warranty.</p>
//     </div>
//   </div>

//   <div class="body">

//     <p class="greeting">Hi ${escapeHtml(firstName)},</p>
//     <p class="greeting">Your product warranty has been successfully registered. Here are the details of your coverage.</p>

//     <div class="product-card">
//       <div class="product-info">
//         <div class="product-name">${escapeHtml(productTitle)}</div>
//         <div class="serial">Serial number: <span>${escapeHtml(serialNumber || "-")}</span></div>
//         <div class="warranty-row">
//           <span class="warranty-badge">✓ Standard Warranty Active</span>
//         </div>
//       </div>
//     </div>

//     <div class="details-grid">
//       <div class="detail-cell">
//         <div class="detail-label">Registration date</div>
//         <div class="detail-value">${escapeHtml(registrationDate || "-")}</div>
//       </div>
//       <div class="detail-cell">
//         <div class="detail-label">Purchase date</div>
//         <div class="detail-value">${escapeHtml(purchaseDate || "-")}</div>
//       </div>
//       <div class="detail-cell">
//         <div class="detail-label">Warranty starts</div>
//         <div class="detail-value">${escapeHtml(warrantyStartDate || "-")}</div>
//       </div>
//       <div class="detail-cell">
//         <div class="detail-label">Warranty expires</div>
//         <div class="detail-value">${escapeHtml(warrantyExpiry || "-")}</div>
//       </div>
//     </div>

//     ${renderAdditionalNotesHtml(additionalNotes)}

//     <div class="cta-block">
//       ${myProductsUrl ? `<a href="${myProductsUrl}" class="cta-primary">View my warranty</a>` : ""}
//       ${shopUrl ? `<a href="${shopUrl}" class="cta-secondary">Continue shopping</a>` : ""}
//     </div>

//     <hr class="divider">

//     <div class="support-block">
//       <p>Need help or want to make a warranty claim? Our support team is ready to assist.<br>
//       ${supportUrl ? `<a href="${supportUrl}">Visit our support centre →</a>` : ""}</p>
//     </div>

//     <p class="sign-off">
//       Thank you for choosing Sennheiser.<br><br>
//       <strong>The Sennheiser Team</strong>
//     </p>

//   </div>

//   <div class="footer">
//     <div class="footer-brand">Sennheiser Consumer Hearing</div>
//     <p>
//       This email confirms your warranty registration. Please retain it for your records.<br>
//       You are receiving this email because you registered a product${shopUrl ? ` at ${shopUrl.replace(/^https?:\/\//, "")}` : ""}.<br><br>
//       ${privacyUrl ? `<a href="${privacyUrl}">Privacy Policy</a>` : ""}${privacyUrl && termsUrl ? " &nbsp;·&nbsp; " : ""}${termsUrl ? `<a href="${termsUrl}">Terms &amp; Conditions</a>` : ""}<br><br>
//       © ${new Date().getFullYear()} Sonova Consumer Hearing GmbH. All rights reserved.
//     </p>
//   </div>

// </div>
// </body>
// </html>
//   `;
// }
