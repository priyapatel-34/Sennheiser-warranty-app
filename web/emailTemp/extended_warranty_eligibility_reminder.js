import { renderEmailLayout, emailButton } from "./_layout.js";

/**
 * Renders the reminder email that nudges customers to extend warranty coverage
 * before their purchase window closes.
 */
export default function ExtendedWarrantyEligibilityReminderTemplate({
  customerName,
  productTitle,
  serialNumber,
  daysRemaining,
  eligibilityEndDate,
  extendWarrantyUrl,
  productDetailsHtml = "",
  storeName,
}) {
  const dayLabel = daysRemaining === 1 ? "day" : "days";

  const bodyHtml = `
    <p>Dear ${customerName || "Customer"},</p><br/>
    <p>
      You have <strong>${daysRemaining} ${dayLabel}</strong> left to purchase extended warranty
      coverage for your registered product.
    </p><br/>
    <p>
      <strong>Product:</strong> ${productTitle}<br/>
      ${serialNumber ? `<strong>Serial Number:</strong> ${serialNumber}<br/>` : ""}
      ${eligibilityEndDate ? `<strong>Offer ends:</strong> ${eligibilityEndDate}<br/>` : ""}
    </p><br/>
    <p>
      ${emailButton({ href: extendWarrantyUrl, label: "Extend Warranty Now" })}
    </p>
    ${productDetailsHtml}
  `;

  return renderEmailLayout({
    heading: "Extended Warranty Offer Ending Soon",
    bodyHtml,
    storeName: "Sonova Team",
  });
}


// import { escapeHtml, renderAdditionalNotesHtml, renderCoverageListSection } from "./_layout.js";

// function resolveHeroHeadline(daysRemaining, productName) {
//   const name = escapeHtml(productName || "your product");
//   if (daysRemaining <= 7) {
//     const dayWord = daysRemaining === 1 ? "day" : "days";
//     return `This is your final reminder — offer closes in ${daysRemaining} ${dayWord}`;
//   }
//   if (daysRemaining <= 14) {
//     return `Your extended warranty offer expires in ${daysRemaining} days`;
//   }
//   return `Protect your ${name} beyond your standard warranty`;
// }

// function resolveUrgency(daysRemaining) {
//   if (daysRemaining <= 7) {
//     return { pillClass: "urgency-pill urgent", label: "Last chance" };
//   }
//   return { pillClass: "urgency-pill", label: "Your offer is waiting" };
// }

// function renderPlanCards(plans = []) {
//   if (!plans.length) return "";

//   return plans
//     .map((plan, index) => {
//       const featured =
//         plan.featured ||
//         plan.merchandisingBadge === "MOST POPULAR" ||
//         (plans.length >= 2 && index === 1);
//       const cardClass = featured ? "plan-card featured" : "plan-card";
//       const title = plan.planName || plan.title || `+${plan.durationYears || ""} Year`;
//       const dates = [plan.startDate, plan.endDate].filter(Boolean).join(" → ");
//       const price = plan.price || plan.displayPrice || "-";

//       return `
//     <div class="${cardClass}">
//       <div class="plan-left">
//         <div class="plan-title">${escapeHtml(title)}</div>
//         <div class="plan-dates">${escapeHtml(dates)}</div>
//       </div>
//       <div class="plan-right">
//         <div class="plan-price">${escapeHtml(price)}</div>
//         <div class="plan-price-label">one-time</div>
//       </div>
//     </div>`;
//     })
//     .join("");
// }

// /**
//  * Fixed Extended Warranty upsell / reminder email — matches the approved
//  * "Extend Your Warranty" design. Layout is not merchant-editable; only
//  * `additionalNotes` (from Email Settings) varies.
//  */
// export default function ExtendedWarrantyEligibilityReminderTemplate({
//   customerName,
//   productTitle,
//   serialNumber,
//   daysRemaining,
//   warrantyExpiryDate,
//   offerExpiryDate,
//   plans = [],
//   upsellUrl,
//   supportUrl,
//   privacyUrl,
//   termsUrl,
//   unsubscribeUrl,
//   additionalNotes = "",
//   coverageBenefits = "",
// }) {
//   const firstName = String(customerName || "Customer").trim().split(/\s+/)[0];
//   const days = Number(daysRemaining) || 0;
//   const urgency = resolveUrgency(days);
//   const heroHeadline = resolveHeroHeadline(days, productTitle);

//   return `
// <!DOCTYPE html>
// <html lang="en">
// <head>
// <meta charset="UTF-8">
// <meta name="viewport" content="width=device-width, initial-scale=1.0">
// <title>Extend Your Warranty</title>
// <style>
//   * { margin: 0; padding: 0; box-sizing: border-box; }
//   body { background-color: #F4F6F8; font-family: Arial, sans-serif; }
//   .wrapper { max-width: 600px; margin: 32px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
//   .header { background-color: #1F4E79; padding: 28px 40px 24px; }
//   .header-wordmark { color: #ffffff; font-size: 20px; font-weight: 700; letter-spacing: 0.04em; }
//   .hero { background: linear-gradient(135deg, #1A2F45 0%, #1F4E79 60%, #2E75B6 100%); padding: 32px 40px 36px; border-bottom: 4px solid #C9A84C; position: relative; overflow: hidden; }
//   .hero::after { content: ""; position: absolute; right: -40px; top: -40px; width: 220px; height: 220px; background: rgba(201,168,76,0.08); border-radius: 50%; }
//   .urgency-pill { display: inline-block; background: #C9A84C; color: #ffffff; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; padding: 5px 14px; border-radius: 20px; margin-bottom: 18px; }
//   .urgency-pill.urgent { background: #C0392B; }
//   .hero h1 { color: #ffffff; font-size: 26px; font-weight: 700; line-height: 1.35; margin-bottom: 10px; }
//   .hero p { color: #B8D0E8; font-size: 14px; line-height: 1.7; }
//   .days-remaining { display: inline-block; margin-top: 18px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; padding: 10px 18px; }
//   .days-remaining .days-number { font-size: 32px; font-weight: 700; color: #C9A84C; line-height: 1; }
//   .days-remaining .days-label { font-size: 11px; color: #9CB8D4; letter-spacing: 0.06em; text-transform: uppercase; margin-top: 2px; }
//   .body { padding: 36px 40px; }
//   .greeting { font-size: 15px; color: #334155; margin-bottom: 20px; line-height: 1.6; }
//   .product-card { background: #F4F8FC; border: 1px solid #D4E4F5; border-radius: 8px; padding: 18px 22px; margin-bottom: 28px; }
//   .product-name { font-size: 16px; font-weight: 700; color: #1F4E79; margin-bottom: 4px; }
//   .product-meta { font-size: 12px; color: #64748B; margin-bottom: 10px; }
//   .product-meta span { font-weight: 600; color: #334155; }
//   .warranty-status-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
//   .badge-standard { background: #E2F5EF; color: #0D7A5F; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 20px; }
//   .badge-expiry { background: #FFF8E6; color: #92680A; font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 20px; }
//   .plans-label { font-size: 13px; font-weight: 700; color: #1F4E79; letter-spacing: 0.04em; text-transform: uppercase; margin-bottom: 12px; }
//   .plan-card { border: 1.5px solid #D4E4F5; border-radius: 8px; padding: 14px 18px; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between; }
//   .plan-card.featured { border-color: #2E75B6; background: #F0F7FF; position: relative; }
//   .plan-card.featured::before { content: "MOST POPULAR"; position: absolute; top: -10px; left: 18px; background: #2E75B6; color: #fff; font-size: 9px; font-weight: 700; letter-spacing: 0.1em; padding: 2px 10px; border-radius: 10px; }
//   .plan-left .plan-title { font-size: 15px; font-weight: 700; color: #1E293B; }
//   .plan-left .plan-dates { font-size: 12px; color: #64748B; margin-top: 2px; }
//   .plan-right { text-align: right; }
//   .plan-right .plan-price { font-size: 18px; font-weight: 700; color: #1F4E79; }
//   .plan-right .plan-price-label { font-size: 11px; color: #94A3B8; }
//   .cta-block { text-align: center; margin: 28px 0 20px; }
//   .cta-primary { display: inline-block; background: #1F4E79; color: #ffffff; font-size: 15px; font-weight: 700; padding: 16px 40px; border-radius: 6px; text-decoration: none; letter-spacing: 0.02em; }
//   .cta-note { font-size: 12px; color: #94A3B8; margin-top: 10px; text-align: center; }
//   .divider { border: none; border-top: 1px solid #E2E8F0; margin: 28px 0; }
//   .coverage-label { font-size: 13px; font-weight: 700; color: #1F4E79; letter-spacing: 0.04em; text-transform: uppercase; margin-bottom: 14px; }
//   .coverage-list { list-style: none; }
//   .coverage-list li { font-size: 13px; color: #475569; padding: 6px 0 6px 24px; position: relative; border-bottom: 1px solid #F1F5F9; line-height: 1.5; }
//   .coverage-list li:last-child { border-bottom: none; }
//   .coverage-list li::before { content: "✓"; position: absolute; left: 0; color: #0D7A5F; font-weight: 700; }
//   .expiry-callout { background: #FFF8E6; border: 1px solid #F0D080; border-radius: 8px; padding: 14px 18px; margin: 24px 0; }
//   .expiry-callout p { font-size: 13px; color: #7A5700; line-height: 1.6; }
//   .expiry-callout strong { color: #5C3D00; }
//   .sign-off { font-size: 14px; color: #334155; line-height: 1.8; margin-top: 24px; }
//   .footer { background: #1A2F45; padding: 24px 40px; }
//   .footer-brand { font-size: 13px; color: #9CB8D4; font-weight: 700; margin-bottom: 8px; }
//   .footer p { font-size: 11px; color: #7A9BB5; line-height: 1.8; }
//   .footer a { color: #9CB8D4; text-decoration: none; }
//   @media (max-width: 480px) {
//     .body, .hero, .header { padding-left: 20px; padding-right: 20px; }
//     .plan-card { flex-direction: column; align-items: flex-start; gap: 8px; }
//     .plan-right { text-align: left; }
//   }
// </style>
// </head>
// <body>
// <div class="wrapper">

//   <div class="header">
//     <div class="header-wordmark">SENNHEISER</div>
//   </div>

//   <div class="hero">
//     <div class="${urgency.pillClass}">${urgency.label}</div>
//     <h1>${heroHeadline}</h1>
//     <p>Your standard warranty covers you until ${escapeHtml(warrantyExpiryDate || "-")}.<br>
//     Extended coverage picks up exactly where it ends — no gap, no overlap.</p>
//     <div class="days-remaining">
//       <div class="days-number">${days}</div>
//       <div class="days-label">days left to claim this offer</div>
//     </div>
//   </div>

//   <div class="body">

//     <p class="greeting">Hi ${escapeHtml(firstName)},</p>
//     <p class="greeting">When you registered your product, you chose to skip extended warranty coverage. That is completely fine — but your offer window is still open, and we wanted to make sure you had a chance to reconsider before it closes on <strong>${escapeHtml(offerExpiryDate || "-")}</strong>.</p>

//     <div class="product-card">
//       <div class="product-name">${escapeHtml(productTitle)}</div>
//       <div class="product-meta">Serial number: <span>${escapeHtml(serialNumber || "-")}</span></div>
//       <div class="warranty-status-row">
//         <span class="badge-standard">✓ Standard warranty active</span>
//         <span class="badge-expiry">Expires ${escapeHtml(warrantyExpiryDate || "-")}</span>
//       </div>
//     </div>

//     ${plans.length ? `<div class="plans-label">Choose your extended coverage</div>${renderPlanCards(plans)}` : ""}

//     ${renderAdditionalNotesHtml(additionalNotes)}

//     <div class="cta-block">
//       ${upsellUrl ? `<a href="${upsellUrl}" class="cta-primary">Extend my warranty</a>` : ""}
//       <p class="cta-note">You will be taken to a secure Sennheiser checkout. No account password required.</p>
//     </div>

//     <hr class="divider">

//     ${renderCoverageListSection(coverageBenefits)}

//     <div class="expiry-callout">
//       <p>⏱ <strong>This offer closes on ${escapeHtml(offerExpiryDate || "-")}.</strong> After this date, extended warranty will no longer be available for this product.${termsUrl ? ` <a href="${termsUrl}" style="color: #92680A;">Terms &amp; conditions apply.</a>` : ""}</p>
//     </div>

//     <p class="sign-off">
//       If you have any questions about extended coverage, our support team is happy to help.<br>
//       ${supportUrl ? `<a href="${supportUrl}" style="color: #2E75B6; font-size: 13px;">Visit our support centre →</a><br>` : ""}
//       <br>
//       <strong style="color: #1F4E79;">The Sennheiser Team</strong>
//     </p>

//   </div>

//   <div class="footer">
//     <div class="footer-brand">Sennheiser Consumer Hearing</div>
//     <p>
//       You are receiving this email because you registered a Sennheiser product and have an active extended warranty offer.<br>
//       This offer expires on ${escapeHtml(offerExpiryDate || "-")} and will not be extended.<br><br>
//       ${privacyUrl ? `<a href="${privacyUrl}">Privacy Policy</a>` : ""}${privacyUrl && termsUrl ? " &nbsp;·&nbsp; " : ""}${termsUrl ? `<a href="${termsUrl}">Terms &amp; Conditions</a>` : ""}${unsubscribeUrl ? ` &nbsp;·&nbsp; <a href="${unsubscribeUrl}">Unsubscribe</a>` : ""}<br><br>
//       © ${new Date().getFullYear()} Sonova Consumer Hearing GmbH. All rights reserved.
//     </p>
//   </div>

// </div>
// </body>
// </html>
//   `;
// }
