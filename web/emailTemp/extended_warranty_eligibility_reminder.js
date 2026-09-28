import {
  renderEmailLayout,
  renderGreeting,
  renderProductCard,
  renderExtendedCoveragePlans,
  renderCoverageListSection,
  emailSection,
  escapeHtml,
  formatEmailDisplayDate,
  emailButton,
  safeHref,
} from "./_layout.js";

function firstName(customerName) {
  return String(customerName || "Customer")
    .trim()
    .split(/\s+/)[0];
}

/**
 * Reminder / upsell email with the Choose your Extended Coverage plan list.
 *
 * IMPORTANT:
 * - Shared _layout.js owns Continue Shopping / Additional Content /
 *   Support / Team / Footer.
 * - Do NOT render the Support / Team section here.
 * - Merchant Additional Content is injected by emailSettings.service.js.
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
  storeUrl,
  privacyUrl,
  termsUrl,
  supportUrl,
  warrantyExpiryDate,
  offerExpiryDate,
  plans = [],
  coverageBenefits = "",
}) {
  const dayLabel = daysRemaining === 1 ? "day" : "days";

  const offerDate = formatEmailDisplayDate(
    offerExpiryDate || eligibilityEndDate
  );

  const warrantyUntil = formatEmailDisplayDate(
    warrantyExpiryDate || eligibilityEndDate
  );

  const termsHref = String(termsUrl || "").trim();

  const intro = `When you registered your product, you chose to skip extended warranty coverage. That is completely fine &#8212; but your offer window is still open, and we wanted to make sure you had a chance to reconsider before it closes${
    offerDate
      ? ` on <strong>${escapeHtml(offerDate)}</strong>`
      : ""
  }.`;

  const expiryPill =
    Number.isFinite(Number(daysRemaining)) &&
    Number(daysRemaining) > 0
      ? `Extension Offer Expires in ${daysRemaining} ${
          dayLabel === "day" ? "Day" : "Days"
        }`
      : "";

  const offerBox = offerDate
    ? emailSection(`
        <table
          width="100%"
          cellspacing="0"
          cellpadding="0"
          style="width:100%; border:1px solid #037CC2; border-radius:8px; background-color:#F0F4F9; border-collapse:separate;"
        >
          <tbody>
            <tr>
              <td width="18" style="width:18px;"></td>

              <td>
                <table
                  width="100%"
                  cellspacing="0"
                  cellpadding="0"
                  style="width:100%;"
                >
                  <tbody>
                    <tr>
                      <td height="14" style="height:14px;"></td>
                    </tr>

                    <tr>
                      <td
                        style="font-size:12px; color:#000000; line-height:1.67; font-weight:400;"
                      >
                        <strong style="font-weight:700;">
                          This offer closes on ${escapeHtml(offerDate)}.
                        </strong>

                        After this date, extended warranty will no longer be
                        available for this product.

                        ${
                          termsHref
                            ? `
                              <a
                                class="custom-link"
                                href="${escapeHtml(termsHref)}"
                                title="Terms &amp; conditions apply"
                                style="color:#037CC2; text-decoration:underline; font-weight:500;"
                              >
                                Terms &amp; conditions apply.
                              </a>
                            `
                            : ""
                        }
                      </td>
                    </tr>

                    <tr>
                      <td height="14" style="height:14px;"></td>
                    </tr>
                  </tbody>
                </table>
              </td>

              <td width="18" style="width:18px;"></td>
            </tr>
          </tbody>
        </table>
      `)
    : "";

  const bodyHtml = [
    renderGreeting({
      name: firstName(customerName),
      introHtml: intro,
    }),

    renderProductCard({
      productTitle,
      serialNumber,
      badges: [
        {
          label: "Standard Warranty Active",
        },

        warrantyUntil
          ? {
              label: `Expires ${warrantyUntil}`,
              tone: "warning",
            }
          : null,
      ].filter(Boolean),
    }),

    renderExtendedCoveragePlans({
      plans,
      ctaHref: extendWarrantyUrl,
      ctaLabel: "Extend my warranty",
    }),

    !plans.length && extendWarrantyUrl
      ? emailSection(`
          <table
            width="100%"
            cellspacing="0"
            cellpadding="0"
            style="width:100%;"
          >
            <tbody>
              <tr>
                <td height="24" style="height:24px;"></td>
              </tr>

              <tr>
                <td align="center" style="text-align:center;">
                  ${emailButton({
                    href: extendWarrantyUrl,
                    label: "Extend my warranty",
                  })}
                </td>
              </tr>

              <tr>
                <td height="24" style="height:24px;"></td>
              </tr>
            </tbody>
          </table>
        `)
      : "",

    productDetailsHtml && !extendWarrantyUrl
      ? emailSection(productDetailsHtml)
      : "",

    renderCoverageListSection(coverageBenefits),

    offerBox,
  ].join("");

  const subtitle = warrantyUntil
    ? `Your standard warranty covers you until ${warrantyUntil}.<br />Extended coverage picks up exactly where it ends — no gap, no overlap.`
    : "Extended coverage picks up exactly where your standard warranty ends — no gap, no overlap.";

  return renderEmailLayout({
    heading: "Extended Warranty Offer Ending Soon",

    bodyHtml,

    storeName: "Sennheiser Hearing",

    storeUrl,
    privacyUrl,
    termsUrl,
    supportUrl,
    hero: {
      badge:
        Number(daysRemaining) <= 7
          ? "Last chance"
          : "Your offer is waiting",

      title: `Protect your ${
        productTitle || "product"
      } beyond your standard warranty`,

      subtitleHtml: subtitle,

      expiry: expiryPill,
    },

    footerNotice:
      `You are receiving this email because you registered a Sennheiser product and have an active extended warranty offer.${
        offerDate
          ? `<br />This offer expires on ${escapeHtml(
              offerDate
            )} and will not be extended.`
          : ""
      }`,
  });
}