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
 * Rejected-refund email when a refund request is denied.
 *
 * IMPORTANT:
 * - Shared _layout.js owns Continue Shopping / Additional Content /
 *   Support / Team / Footer.
 * - Do NOT render the Support / Team section here.
 */
export default function ExtendedWarrantyRefundRejectedTemplate({
  customerName,
  productTitle,
  planName,
  rejectionReason,
  productDetailsHtml = "",
  storeUrl,
  privacyUrl,
  termsUrl,
  supportUrl,
  storeName,
  serialNumber,
  processedDate,
  viewWarrantyUrl,
}) {
  const bodyHtml = [
    renderGreeting({
      name: firstName(customerName),

      introHtml:
        "We were unable to approve your extended warranty refund request at this time. Below are the details of our decision.",
    }),

    renderProductCard({
      productTitle,
      serialNumber,

      badges: [
        {
          label: "Refund Not Approved",
          tone: "warning",
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
                  label: "Status",
                  value: "Not approved",
                },
                {
                  label: "Decision date",
                  value:
                    formatEmailDisplayDate(
                      processedDate
                    ),
                },
                {
                  label: "Reason",
                  value:
                    rejectionReason ||
                    "Not specified",
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
    heading: "Extended Warranty Refund Request Update",

    bodyHtml,

    storeName: "Sennheiser Hearing",

    storeUrl,
    privacyUrl,
    termsUrl,
    supportUrl,
    hero: {
      badge: "Refund Update",

      title:
        "Your refund request was not approved",

      subtitle:
        "We reviewed your extended warranty refund request and were unable to approve it at this time.",
    },

    footerNotice:
      "This email confirms the outcome of your extended warranty refund request. Please retain it for your records.",
  });
}