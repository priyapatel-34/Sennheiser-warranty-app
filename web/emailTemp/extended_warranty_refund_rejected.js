import { renderEmailLayout } from "./_layout.js";

export default function ExtendedWarrantyRefundRejectedTemplate({
  customerName,
  productTitle,
  planName,
  rejectionReason,
  productDetailsHtml = "",
}) {
  const bodyHtml = `
    <p>Dear ${customerName || "Customer"},</p><br/>
    <p>We were unable to approve your extended warranty refund request at this time.</p><br/>
    <p>
      <strong>Product:</strong> ${productTitle}<br/>
      <strong>Plan:</strong> ${planName}<br/>
      ${rejectionReason ? `<strong>Reason:</strong> ${rejectionReason}<br/>` : ""}
    </p>
    ${productDetailsHtml}
     <br/>
  `;

  return renderEmailLayout({
    heading: "Extended Warranty Refund Request Update",
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
//  * Fixed Extended Warranty Refund Rejected email — matches the approved
//  * Standard/Extended registration design system.
//  */
// export default function ExtendedWarrantyRefundRejectedTemplate({
//   customerName,
//   productTitle,
//   serialNumber,
//   planName,
//   rejectionReason,
//   processedDate,
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
// <title>Extended Warranty Refund Update</title>
// <style>${FIXED_REGISTRATION_EMAIL_STYLES}</style>
// </head>
// <body>
// <div class="wrapper">

//   <div class="header">
//     <div class="header-wordmark">SENNHEISER</div>
//   </div>

//   <div class="hero">
//     <div style="padding-top: 24px;">
//       <div class="hero-label hero-label--warning">REFUND UPDATE</div>
//       <h1>Your refund request was not approved</h1>
//       <p>We reviewed your extended warranty refund request and were unable to approve it at this time.</p>
//     </div>
//   </div>

//   <div class="body">

//     <p class="greeting">Hi ${escapeHtml(firstName)},</p>
//     <p class="greeting">Thank you for your patience. Below are the details of our decision regarding your refund request.</p>

//     <div class="product-card">
//       <div class="product-info">
//         <div class="product-name">${escapeHtml(productTitle)}</div>
//         <div class="serial">Serial number: <span>${escapeHtml(serialNumber || "-")}</span></div>
//         <div class="warranty-row">
//           <span class="warranty-badge warranty-badge--warning">Refund Not Approved</span>
//         </div>
//       </div>
//     </div>

//     <div class="details-grid">
//       <div class="detail-cell">
//         <div class="detail-label">Plan</div>
//         <div class="detail-value">${escapeHtml(planName || "-")}</div>
//       </div>
//       <div class="detail-cell">
//         <div class="detail-label">Status</div>
//         <div class="detail-value">Not approved</div>
//       </div>
//       <div class="detail-cell">
//         <div class="detail-label">Decision date</div>
//         <div class="detail-value">${escapeHtml(processedDate || "-")}</div>
//       </div>
//       <div class="detail-cell">
//         <div class="detail-label">Reason</div>
//         <div class="detail-value">${escapeHtml(rejectionReason || "Not specified")}</div>
//       </div>
//     </div>

//     ${renderAdditionalNotesHtml(additionalNotes)}

//     <div class="cta-block">
//       ${myProductsUrl ? `<a href="${myProductsUrl}" class="cta-primary">View my warranty</a>` : ""}
//       ${shopUrl ? `<a href="${shopUrl}" class="cta-secondary">Continue shopping</a>` : ""}
//     </div>

//     <hr class="divider">

//     <div class="support-block">
//       <p>If you have questions about this decision, our support team is ready to help.<br>
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
//       This email confirms the outcome of your extended warranty refund request. Please retain it for your records.<br>
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
