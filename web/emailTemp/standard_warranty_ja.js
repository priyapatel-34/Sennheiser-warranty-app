import {
  renderEmailLayout,
  renderGreeting,
  renderProductCard,
  renderDetailsGrid,
  renderCtaBlock,
  emailSection,
  escapeHtml,
  formatEmailDisplayDate,
} from "./_layout.js";
import { renderViewProductDetailsButton } from "../services/emailLink.service.js";

/**
 * Japanese standard-warranty confirmation email.
 *
 * IMPORTANT:
 * - This remains the dedicated Japanese template.
 * - It uses the same shared layout/components as standard_warranty.js.
 * - It is selected when locale === "ja".
 */
export default function WarrantyRegistrationSuccessTemplateJA({
  customerName,
  productTitle,
  orderNumber,
  purchaseDate,
  warrantyPeriod,
  serialNumber,
  shopDomain,
  warrantyStartDate,
  warrantyExpiry,
  registrationDate,
  viewWarrantyUrl,
  registerId,
  storeUrl = "",
  privacyUrl = "",
  termsUrl = "",
  supportUrl = "",
}) {
  const expiryDisplay = formatEmailDisplayDate(warrantyExpiry);

  const details = renderDetailsGrid([
    {
      label: "注文番号",
      value: orderNumber || "—",
    },
    {
      label: "登録日",
      value: formatEmailDisplayDate(registrationDate),
    },
    {
      label: "購入日",
      value: formatEmailDisplayDate(purchaseDate),
    },
    {
      label: "保証期限",
      value: expiryDisplay,
    },
  ]);

  const bodyHtml = [
    renderGreeting({
      name: `${escapeHtml(customerName || "お客様")} 様`,
      introHtml:
        "製品のご登録ありがとうございました。以下の内容で製品が登録されました。",
    }),

    renderProductCard({
      productTitle,
      serialNumber,
      badges: [
        {
          label: "製品登録済み",
        },
        expiryDisplay
          ? {
              label: `保証期限 ${expiryDisplay}`,
              tone: "warning",
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
            <td height="24" style="height:24px;"></td>
          </tr>

          <tr>
            <td>
              ${details}
            </td>
          </tr>
        </tbody>
      </table>
    `),

    // Use the actual URL here
    viewWarrantyUrl
      ? renderCtaBlock({
          href: viewWarrantyUrl,
          label: "製品詳細を見る",
        })
      : "",
  ].join("");

  const additionalContentHtml = `
    <p
      style="
        font-size:14px;
        font-weight:400;
        line-height:1.6;
        color:#000000;
        margin:0;
      "
    >
      ※ご登録いただいた購入日が実際の購入日と異なる場合は、
      購入証明書に記載された購入日をもとに保証期間が決定されます。
      購入証明書をご提供いただけない場合や、保証対象外となる理由がある場合は、
      製品をご登録いただいた場合でも、保証による修理受付ができないことがございますので、
      あらかじめご了承ください。
    </p>

    <p
      style="
        font-size:14px;
        font-weight:400;
        line-height:1.6;
        color:#000000;
        margin:24px 0 0;
      "
    >
      修理が必要な場合には以下のリンクよりお申し込みください。
    </p>

    <p
      style="
        font-size:14px;
        line-height:1.6;
        margin:8px 0 0;
      "
    >
      <a
        href="https://spares.sennheiser-hearing.com/ja/catalog"
        target="_blank"
        rel="noopener noreferrer"
        style="color:#037CC2; text-decoration:underline;"
      >
        https://spares.sennheiser-hearing.com/ja/catalog
      </a>
    </p>

    <p
      style="
        font-size:14px;
        font-weight:400;
        line-height:1.6;
        color:#000000;
        margin:24px 0 0;
      "
    >
      ご不明な点につきましては、以下のフォームよりお問い合わせください。
    </p>

    <p
      style="
        font-size:14px;
        line-height:1.6;
        margin:8px 0 0;
      "
    >
      <a
        href="${escapeHtml(
          supportUrl ||
            "https://support.sennheiser-hearing.com/hc/ja-jp/requests/new",
        )}"
        target="_blank"
        rel="noopener noreferrer"
        style="color:#037CC2; text-decoration:underline;"
      >
        お問い合わせ
      </a>
    </p>
  `;

  return renderEmailLayout({
    heading: "製品登録が完了しました",
    bodyHtml,
    storeName: "Sennheiser Hearing",
    signOff: "The Sennheiser Team",
    storeUrl,
    privacyUrl,
    termsUrl,
    supportUrl,
    additionalContentHtml,
    labels: {
      continueShopping: "お買い物を続ける",
      supportMessage:
        "ご不明な点がございましたらお気軽にお問い合わせください。",
      supportLink: "サポートセンターはこちら →",
      privacy: "プライバシーポリシー",
      terms: "利用規約",
      rights: "無断転載を禁じます。",
    },
  });
}