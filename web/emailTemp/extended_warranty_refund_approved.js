import {
  renderEmailLayout,
  renderGreeting,
  renderProductCard,
  renderDetailsGrid,
  renderCtaBlock,
  emailSection,
  formatEmailDisplayDate,
} from "./_layout.js";

function firstName(customerName) {
  return String(customerName || "Customer")
    .trim()
    .split(/\s+/)[0];
}

/**
 * Approved-refund email after a refund request is accepted.
 *
 * IMPORTANT:
 * - Shared _layout.js owns Continue Shopping / Additional Content /
 *   Support / Team / Footer.
 * - Do NOT render the Support / Team section here.
 */
export default function ExtendedWarrantyRefundApprovedTemplate({
  customerName,
  productTitle,
  planName,
  refundAmount,
  currency,
  storeName,
  productDetailsHtml = "",
  storeUrl,
  privacyUrl,
  termsUrl,
  supportUrl,
  serialNumber,
  processedDate,
  viewWarrantyUrl,
}) {
  const amountDisplay =
    String(refundAmount || "").trim() ||
    [refundAmount, currency]
      .filter(Boolean)
      .join(" ");

  const bodyHtml = [
    renderGreeting({
      name: firstName(customerName),

      introHtml:
        "Your extended warranty refund request has been approved. Here are the details.",
    }),

    renderProductCard({
      productTitle,
      serialNumber,

      badges: [
        {
          label: "Refund Approved",
        },
      ],
    }),

    emailSection(`
      <table
        width="100%"
        cellspacing="0"
        cellpadding="0"
        style="width:100%;"
      >
        <tbody>
          <tr>
            <td
              height="24"
              style="height:24px;"
            ></td>
          </tr>

          <tr>
            <td>
              ${renderDetailsGrid([
                {
                  label: "Plan",
                  value: planName,
                },
                {
                  label: "Refund amount",
                  value: amountDisplay,
                },
                {
                  label: "Status",
                  value: "Approved",
                },
                {
                  label: "Processed date",
                  value:
                    formatEmailDisplayDate(
                      processedDate
                    ),
                },
              ])}
            </td>
          </tr>
        </tbody>
      </table>
    `),

    viewWarrantyUrl
      ? renderCtaBlock({
          href: viewWarrantyUrl,
          label: "View my warranty",
        })
      : productDetailsHtml
        ? emailSection(productDetailsHtml)
        : "",
  ].join("");

  return renderEmailLayout({
    heading: "Extended Warranty Refund Approved",

    bodyHtml,

    storeName: "Sennheiser Hearing",

    storeUrl,
    privacyUrl,
    termsUrl,
    supportUrl,
    hero: {
      badge: "Refund Approved",

      title: "Your refund has been approved",

      subtitle:
        "We have processed your extended warranty refund request. Keep this email as your confirmation.",
    },

    footerNotice:
      "This email confirms your extended warranty refund approval. Please retain it for your records.",
  });
}