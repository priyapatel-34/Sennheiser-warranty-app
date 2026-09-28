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
 * Extended-warranty purchase confirmation after upsell checkout.
 *
 * IMPORTANT:
 * - Shared _layout.js owns Continue Shopping / Additional Content /
 *   Support / Team / Footer.
 * - Do NOT render the Support / Team section here.
 */
export default function ExtendedWarrantyPurchaseTemplate({
  customerName,
  productTitle,
  orderNumber,
  planName,
  durationMonths,
  price,
  currency,
  serialNumber,
  activationDate,
  expiryDate,
  productDetailsHtml = "",
  storeUrl,
  privacyUrl,
  termsUrl,
  supportUrl,
  viewWarrantyUrl,
}) {
  const amountPaid = [price, currency]
    .filter(Boolean)
    .join(" ");

  const details = renderDetailsGrid([
    {
      label: "Order number",
      value: orderNumber,
    },
    {
      label: "Plan",
      value: planName,
    },
    {
      label: "Amount paid",
      value: amountPaid,
    },
    {
      label: "Coverage ends",
      value: formatEmailDisplayDate(expiryDate),
    },
  ]);

  const bodyHtml = [
    renderGreeting({
      name: firstName(customerName),

      introHtml:
        "Thank you for purchasing extended warranty coverage for your registered product. Your extended warranty has been added to your product.",
    }),

    renderProductCard({
      productTitle,
      serialNumber,

      badges: [
        {
          label: "Extended Warranty Active",
        },

        planName
          ? {
            label: planName,
          }
          : null,
      ].filter(Boolean),
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
              class="h-24"
              height="24"
              style="height:24px;"
            ></td>
          </tr>

          <tr>
            <td>
              ${details}
            </td>
          </tr>
        </tbody>
      </table>
    `),

    viewWarrantyUrl
      ? renderCtaBlock({
        href: viewWarrantyUrl,
        label: "View Product warranty",
      })
      : productDetailsHtml
        ? emailSection(productDetailsHtml)
        : "",
  ].join("");

  return renderEmailLayout({
    heading: "Extended Warranty Purchase Confirmation",

    bodyHtml,

    storeName: "Sennheiser Hearing",

    storeUrl,
    privacyUrl,
    termsUrl,
    supportUrl,
    hero: {
      badge: "Extended Warranty Active",
      title: "Your extended warranty is active",
      subtitle:
        "Thank you for extending your coverage. Keep this email as your proof of coverage.",
    },

    footerNotice:
      "This email confirms your extended warranty purchase. Please retain it for your records.",
  });
}