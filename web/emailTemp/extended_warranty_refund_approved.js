import { renderEmailLayout } from "./_layout.js";

export default function ExtendedWarrantyRefundApprovedTemplate({
  customerName,
  productTitle,
  planName,
  refundAmount,
  currency,
  storeName,
  productDetailsHtml = "",
}) {
  const bodyHtml = `
    <p>Dear ${customerName || "Customer"},</p><br/>
    <p>Your extended warranty refund request has been approved.</p><br/>
    <p>
      <strong>Product:</strong> ${productTitle}<br/>
      <strong>Plan:</strong> ${planName}<br/>
      <strong>Approved refund amount:</strong> ${refundAmount} ${currency || ""}<br/>
    </p>
    ${productDetailsHtml}
     <br/>
  `;

  return renderEmailLayout({
    heading: "Extended Warranty Refund Approved",
    bodyHtml,
    storeName: "Sonova Team",
  });
}


// import {
//   escapeHtml,
//   renderAdditionalNotesHtml,
//   FIXED_REGISTRATION_EMAIL_STYLES,
// } from "./_layout.js";

// /**
//  * Fixed Extended Warranty Refund Approved email — matches the approved
//  * Standard/Extended registration design system.
//  */
// export default function ExtendedWarrantyRefundApprovedTemplate({
//   customerName,
//   productTitle,
//   serialNumber,
//   planName,
//   refundAmount,
//   currency,
//   processedDate,
//   myProductsUrl,
//   shopUrl,
//   supportUrl,
//   privacyUrl,
//   termsUrl,
//   additionalNotes = "",
// }) {
//   const firstName = String(customerName || "Customer").trim().split(/\s+/)[0];
//   const amountDisplay =
//     String(refundAmount || "").trim() ||
//     [refundAmount, currency].filter(Boolean).join(" ");

//   return `
// <!DOCTYPE html>
// <html lang="en">
// <head>
// <meta charset="UTF-8">
// <meta name="viewport" content="width=device-width, initial-scale=1.0">
// <title>Extended Warranty Refund Approved</title>
// <style>${FIXED_REGISTRATION_EMAIL_STYLES}</style>
// </head>
// <body>
// <div class="wrapper">

//   <div class="header">
//     <div class="header-wordmark">SENNHEISER</div>
//   </div>

//   <div class="hero">
//     <div style="padding-top: 24px;">
//       <div class="hero-label">✓ REFUND APPROVED</div>
//       <h1>Your refund has been approved</h1>
//       <p>We have processed your extended warranty refund request.<br>Keep this email as your confirmation.</p>
//     </div>
//   </div>

//   <div class="body">

//     <p class="greeting">Hi ${escapeHtml(firstName)},</p>
//     <p class="greeting">Your extended warranty refund request has been approved. Here are the details.</p>

//     <div class="product-card">
//       <div class="product-info">
//         <div class="product-name">${escapeHtml(productTitle)}</div>
//         <div class="serial">Serial number: <span>${escapeHtml(serialNumber || "-")}</span></div>
//         <div class="warranty-row">
//           <span class="warranty-badge">✓ Refund Approved</span>
//         </div>
//       </div>
//     </div>

//     <div class="details-grid">
//       <div class="detail-cell">
//         <div class="detail-label">Plan</div>
//         <div class="detail-value">${escapeHtml(planName || "-")}</div>
//       </div>
//       <div class="detail-cell">
//         <div class="detail-label">Refund amount</div>
//         <div class="detail-value">${escapeHtml(amountDisplay || "-")}</div>
//       </div>
//       <div class="detail-cell">
//         <div class="detail-label">Status</div>
//         <div class="detail-value">Approved</div>
//       </div>
//       <div class="detail-cell">
//         <div class="detail-label">Processed date</div>
//         <div class="detail-value">${escapeHtml(processedDate || "-")}</div>
//       </div>
//     </div>

//     ${renderAdditionalNotesHtml(additionalNotes)}

//     <div class="cta-block">
//       ${myProductsUrl ? `<a href="${myProductsUrl}" class="cta-primary">View my warranty</a>` : ""}
//       ${shopUrl ? `<a href="${shopUrl}" class="cta-secondary">Continue shopping</a>` : ""}
//     </div>

//     <hr class="divider">

//     <div class="support-block">
//       <p>Questions about your refund? Our support team is ready to assist.<br>
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
//       This email confirms your extended warranty refund approval. Please retain it for your records.<br>
//       You are receiving this email because you requested a refund for extended warranty coverage${shopUrl ? ` at ${shopUrl.replace(/^https?:\/\//, "")}` : ""}.<br><br>
//       ${privacyUrl ? `<a href="${privacyUrl}">Privacy Policy</a>` : ""}${privacyUrl && termsUrl ? " &nbsp;·&nbsp; " : ""}${termsUrl ? `<a href="${termsUrl}">Terms &amp; Conditions</a>` : ""}<br><br>
//       © ${new Date().getFullYear()} Sonova Consumer Hearing GmbH. All rights reserved.
//     </p>
//   </div>

// </div>
// </body>
// </html>
//   `;
// }
