export function renderEmailLayout({
  heading,
  bodyHtml,
  storeName = "Sonova Team",
  signOff = "Kind regards,",
}) {
  return `
    <div style="font-family: Arial, Helvetica, sans-serif; background:#f6f8fb; padding:40px 20px;">
      <div style="max-width:600px; margin:auto; background:#ffffff; padding:40px; border-radius:8px;">
        <h2 style="margin-top:0;">${heading}</h2>
        ${bodyHtml}
        <p style="margin-top:30px;">
          ${signOff}<br/>
          <strong>${storeName}</strong>
        </p>
      </div>
    </div>
  `;
}

export function emailButton({ href, label }) {
  return `
    <a href="${href}" style="display:inline-block; background:#000; color:#fff; padding:12px 24px; text-decoration:none; border-radius:4px; font-weight:bold;">
      ${label}
    </a>
  `;
}


// export function renderEmailLayout({
//   heading,
//   bodyHtml,
//   storeName = "Sonova Team",
//   signOff = "Kind regards,",
// }) {
//   return `
//     <div style="font-family: Arial, Helvetica, sans-serif; background:#f6f8fb; padding:40px 20px;">
//       <div style="max-width:600px; margin:auto; background:#ffffff; padding:40px; border-radius:8px;">
//         <h2 style="margin-top:0;">${heading}</h2>
//         ${bodyHtml}
//         <p style="margin-top:30px;">
//           ${signOff}<br/>
//           <strong>${storeName}</strong>
//         </p>
//       </div>
//     </div>
//   `;
// }

// export function emailButton({ href, label }) {
//   return `
//     <a href="${href}" style="display:inline-block; background:#000; color:#fff; padding:12px 24px; text-decoration:none; border-radius:4px; font-weight:bold;">
//       ${label}
//     </a>
//   `;
// }

// export function escapeHtml(value) {
//   return String(value ?? "")
//     .replace(/&/g, "&amp;")
//     .replace(/</g, "&lt;")
//     .replace(/>/g, "&gt;")
//     .replace(/"/g, "&quot;")
//     .replace(/'/g, "&#39;");
// }

// /**
//  * Shared "Additional Notes" block used by the fixed Standard/Extended/Reminder
//  * templates. Renders nothing when empty, per the merchant-facing requirement
//  * that an unset note must not leave a visible gap in the email.
//  */
// export function renderAdditionalNotesHtml(notes) {
//   const trimmed = String(notes || "").trim();
//   if (!trimmed) return "";
//   return `
//     <div style="background:#F8FAFC;border-left:4px solid #2E75B6;border-radius:0 6px 6px 0;padding:16px 20px;margin-bottom:28px;">
//       <div style="font-size:11px;color:#94A3B8;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:6px;">Additional Notes</div>
//       <p style="font-size:13px;color:#475569;line-height:1.6;white-space:pre-line;margin:0;">${escapeHtml(trimmed)}</p>
//     </div>
//   `;
// }

// /** Plain-text lines (one benefit per line) for reminder email coverage lists. */
// export function parseCoverageBenefitLines(text) {
//   return String(text || "")
//     .split(/\r?\n/)
//     .map((line) => line.trim())
//     .filter(Boolean);
// }

// /**
//  * Renders the reminder email "What extended coverage includes" block.
//  * Returns an empty string when there are no benefits (section hidden).
//  */
// export function renderCoverageListSection(benefits) {
//   const lines = Array.isArray(benefits)
//     ? benefits.map((line) => String(line || "").trim()).filter(Boolean)
//     : parseCoverageBenefitLines(benefits);

//   if (!lines.length) return "";

//   return `
//     <div class="coverage-label">What extended coverage includes</div>
//     <ul class="coverage-list">
//       ${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
//     </ul>
//   `;
// }

// /** Shared CSS for fixed registration-style emails (standard, extended, refund). */
// export const FIXED_REGISTRATION_EMAIL_STYLES = `
//   * { margin: 0; padding: 0; box-sizing: border-box; }
//   body { background-color: #F4F6F8; font-family: Arial, sans-serif; }
//   .wrapper { max-width: 600px; margin: 32px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
//   .header { background-color: #1F4E79; padding: 32px 40px 28px; }
//   .header-wordmark { color: #ffffff; font-size: 20px; font-weight: 700; letter-spacing: 0.04em; }
//   .hero { background-color: #1F4E79; padding: 0 40px 36px; border-bottom: 4px solid #C9A84C; }
//   .hero-label { display: inline-block; background: #C9A84C; color: #ffffff; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; padding: 4px 12px; border-radius: 20px; margin-bottom: 16px; }
//   .hero-label--warning { background: #FFF8E6; color: #92680A; }
//   .hero h1 { color: #ffffff; font-size: 26px; font-weight: 700; line-height: 1.3; }
//   .hero p { color: #B8D0E8; font-size: 14px; margin-top: 8px; line-height: 1.6; }
//   .body { padding: 36px 40px; }
//   .greeting { font-size: 15px; color: #334155; margin-bottom: 20px; line-height: 1.6; }
//   .product-card { background: #F4F8FC; border: 1px solid #D4E4F5; border-radius: 8px; padding: 20px 24px; margin-bottom: 28px; }
//   .product-card .product-info { flex: 1; }
//   .product-card .product-name { font-size: 17px; font-weight: 700; color: #1F4E79; margin-bottom: 4px; }
//   .product-card .serial { font-size: 12px; color: #64748B; margin-bottom: 12px; }
//   .product-card .serial span { font-weight: 600; color: #334155; }
//   .warranty-row { display: flex; gap: 8px; margin-top: 4px; flex-wrap: wrap; }
//   .warranty-badge { background: #E2F5EF; color: #0D7A5F; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 20px; }
//   .warranty-badge--warning { background: #FFF8E6; color: #92680A; }
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
// `;
