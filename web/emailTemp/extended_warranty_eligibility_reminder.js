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
import { copyText, fillCopy, fillPlain, plainToHtml } from "../services/emailCopyCatalog.js";

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
  copy = {},
}) {
  const dayLabel = daysRemaining === 1
    ? copyText(copy, "daySingular", "Day")
    : copyText(copy, "dayPlural", "Days");

  const offerDate = formatEmailDisplayDate(
    offerExpiryDate || eligibilityEndDate
  );

  const warrantyUntil = formatEmailDisplayDate(
    warrantyExpiryDate || eligibilityEndDate
  );

  const termsHref = String(termsUrl || "").trim();

  const intro = offerDate
    ? plainToHtml(fillPlain(copyText(copy, "introWithDate", ""), { date: offerDate }))
    : plainToHtml(copyText(copy, "intro", ""));

  const expiryPill =
    Number.isFinite(Number(daysRemaining)) &&
    Number(daysRemaining) > 0
      ? fillPlain(copyText(copy, "expiryPill", "Extension Offer Expires in {{days}} {{dayLabel}}"), {
          days: daysRemaining,
          dayLabel,
        })
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
                          ${escapeHtml(fillPlain(copyText(copy, "offerCloses", "This offer closes on {{date}}."), { date: offerDate }))}
                        </strong>
                        ${escapeHtml(copyText(copy, "offerClosedAfter", "After this date, extended warranty will no longer be available for this product."))}

                        ${
                          termsHref
                            ? `
                              <a
                                class="custom-link"
                                href="${escapeHtml(termsHref)}"
                                title="${escapeHtml(copyText(copy, "termsApply", "Terms & conditions apply."))}"
                                style="color:#037CC2; text-decoration:underline; font-weight:500;"
                              >
                                ${escapeHtml(copyText(copy, "termsApply", "Terms & conditions apply."))}
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
      salutation: fillCopy(copyText(copy, "greeting", "Hi {{name}},"), {
        name: firstName(customerName),
      }),
      introHtml: intro,
    }),

    renderProductCard({
      productTitle,
      serialNumber,
      serialLabel: copyText(copy, "serialLabel", "Serial number"),
      badges: [
        {
          label: copyText(copy, "activeBadge", "Standard Warranty Active"),
        },

        warrantyUntil
          ? {
              label: fillPlain(copyText(copy, "expiresBadge", "Expires {{date}}"), { date: warrantyUntil }),
              tone: "warning",
            }
          : null,
      ].filter(Boolean),
    }),

    renderExtendedCoveragePlans({
      plans,
      ctaHref: extendWarrantyUrl,
      ctaLabel: copyText(copy, "extendButton", "Extend my warranty"),
      title: copyText(copy, "plansTitle", "Choose your Extended Coverage"),
      coveragePrefix: copyText(copy, "coveragePrefix", "Coverage"),
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
                    label: copyText(copy, "extendButton", "Extend my warranty"),
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

    renderCoverageListSection(coverageBenefits, copyText(copy, "coverageTitle", "What extended coverage includes")),

    offerBox,
  ].join("");

  const subtitle = warrantyUntil
    ? plainToHtml(fillPlain(copyText(copy, "heroSubtitleWithDate", ""), { date: warrantyUntil }))
    : plainToHtml(copyText(copy, "heroSubtitle", ""));

  return renderEmailLayout({
    heading: copyText(copy, "heading", "Extended Warranty Offer Ending Soon"),
    bodyHtml,
    storeName: copyText(copy, "footerName", "Sennheiser Hearing"),
    signOff: copyText(copy, "signOff", "The Sennheiser Hearing"),
    storeUrl,
    privacyUrl,
    termsUrl,
    supportUrl,
    labels: {
      continueShopping: copyText(copy, "continueShopping", "Continue shopping"),
      supportMessage: copyText(copy, "supportMessage", ""),
      supportLink: copyText(copy, "supportLink", "Visit our support centre →"),
      privacy: copyText(copy, "privacy", "Privacy Policy"),
      terms: copyText(copy, "terms", "Terms & Conditions"),
      copyright: copyText(copy, "copyright", "Sonova Consumer Hearing GmbH. All rights reserved."),
    },
    hero: {
      badge:
        Number(daysRemaining) <= 7
          ? copyText(copy, "heroBadgeSoon", "Last chance")
          : copyText(copy, "heroBadgeWaiting", "Your offer is waiting"),
      title: fillPlain(copyText(copy, "heroTitle", "Protect your {{product}} beyond your standard warranty"), {
        product: productTitle || "product",
      }),
      subtitleHtml: subtitle,
      expiry: expiryPill,
    },
    footerNotice: plainToHtml(copyText(copy, "footerNotice", "")),
  });
}