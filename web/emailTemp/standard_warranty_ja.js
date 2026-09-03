import { renderEmailLayout } from "./_layout.js";
import { renderViewProductDetailsButton } from "../services/emailLink.service.js";

export default function WarrantyRegistrationSuccessTemplateJA({
    customerName,
    productTitle,
    orderNumber,
    purchaseDate,
    warrantyPeriod,
    serialNumber,
    shopDomain,
    registerId,
}) {
    const productDetailsButton = renderViewProductDetailsButton(
        shopDomain,
        registerId,
        {
            label: "製品詳細を見る",
        },
    );

    const bodyHtml = ` <p> ${customerName || "お客様"} 様 </p>

    <p>
      この度は製品をご登録いただき、誠にありがとうございます。
    </p>
    <br />
    <p>
      <strong>製品：</strong> ${productTitle}<br />
      ${orderNumber && orderNumber !== "N/A" ? `<strong>注文番号：</strong> ${orderNumber}<br />` : ""}
      ${purchaseDate ? `<strong>購入日：</strong> ${purchaseDate}<br />` : ""}
      ${serialNumber ? `<strong>シリアル番号：</strong> ${serialNumber}<br />` : ""}
      <strong>保証期間：</strong> ${warrantyPeriod}<br />
    </p>

     ${productDetailsButton}
     <br />

    <p>
      ※もしもご登録いただいた購入日が実際の購入日と異なる場合には、購入証明書に書かれた購入日をもとに保証期間が決定されます。
        購入証明書をご提供いただけない場合や、保証対象外の理由がある場合には、今回の登録にかかわらず、保証による修理受付ができませんので、ご注意ください。
    </p><br />
    <p>
    修理が必要な場合には以下のリンクよりお申し込みください。
    </p><br />
    <p>
      <a
        href="https://spares.sennheiser-hearing.com/ja/catalog"
        target="_blank"
        rel="noopener noreferrer"
        >
        https://spares.sennheiser-hearing.com/ja/catalog
        </a>
    </p><br />

    <p>ご不明な点につきましては、以下のフォームよりお問い合わせください。</p><br />
    <a href="https://support.sennheiser-hearing.com/hc/ja-jp/requests/new" target="_blank" rel="noopener noreferrer">お問い合わせ</a>
    <br />
  `;

    return renderEmailLayout({
        heading: "保証登録が完了しました",
        bodyHtml,
        storeName: "Sonova チーム",
        signOff: "敬具",
    });
}