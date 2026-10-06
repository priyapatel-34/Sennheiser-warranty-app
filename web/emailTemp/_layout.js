export const ADMIN_EMAIL_EXTRA_MARKER = "<!-- ADMIN_EMAIL_EXTRA -->";

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Formats dates for customer-facing email copy (e.g. "Jun 07, 2027").
 * ISO YYYY-MM-DD values are treated as calendar dates in UTC to avoid
 * timezone day-shifts.
 */
export function formatEmailDisplayDate(value) {
  if (value == null || value === "") return "";
  const raw = value instanceof Date ? value : String(value).trim();
  if (!raw) return "";

  let date;
  if (raw instanceof Date) {
    date = raw;
  } else {
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
    if (iso) {
      date = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    } else {
      date = new Date(raw);
    }
  }
  if (Number.isNaN(date.getTime())) return escapeHtml(String(value));
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function storeHostname(storeUrl) {
  if (!storeUrl) return "";
  try {
    return new URL(storeUrl).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

export function safeHref(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
}

/**
 * Shared CTA button used by templates and the product-details helper.
 */
export function emailButton({ href = "#", label, title }) {
  const safe = safeHref(href) || "#";
  const text = escapeHtml(label || "");
  const titleAttr = escapeHtml(title || label || "");

  return `
    <a
      class="btn"
      href="${escapeHtml(safe)}"
      title="${titleAttr}"
      style="
        display:block;
        width:250px;
        max-width:250px;
        margin:0 auto;
        box-sizing:border-box;
        background-color:#037CC2;
        border-radius:4px;
        padding:14px 16px;
        color:#ffffff;
        font-size:16px;
        font-weight:500;
        text-decoration:none;
        text-align:center;
        line-height:22px;
        white-space:nowrap;
        font-family:Arial, Helvetica, sans-serif;
      "
    >
      ${text}
    </a>
  `;
}

/**
 * Horizontal padding frame used by every body section.
 */
export function emailSection(innerHtml) {
  return `
    <tr>
      <td>
        <table width="100%" cellspacing="0" cellpadding="0" style="width:100%;">
          <tbody>
            <tr>
              <td class="w-30" width="40" style="width:40px;"></td>
              <td>${innerHtml || ""}</td>
              <td class="w-30" width="40" style="width:40px;"></td>
            </tr>
          </tbody>
        </table>
      </td>
    </tr>
  `;
}

/**
 * Wraps arbitrary HTML (paragraphs, extra merchant content) in the standard
 * padded body column so templates that do not emit full <tr> rows still work.
 */
export function emailContent({ contentHtml }) {
  const inner = String(contentHtml || "").trim();
  if (!inner) return "";
  if (/^<tr[\s>]/i.test(inner)) return inner;
  return emailSection(`
    <table width="100%" cellspacing="0" cellpadding="0" style="width:100%;">
      <tbody>
        <tr><td class="h-30" height="40" style="height:40px;"></td></tr>
        <tr><td>${inner}</td></tr>
        <tr><td height="24" style="height:24px;"></td></tr>
      </tbody>
    </table>
  `);
}

function normalizeBodyRows(bodyHtml) {
  return emailContent({ contentHtml: bodyHtml });
}

export function renderAdditionalNotesHtml(notes) {
  const trimmed = String(notes || "").trim();
  if (!trimmed) return "";
  return `
    <div style="background:#F0F4F9;border-left:4px solid #037CC2;border-radius:0 6px 6px 0;padding:16px 20px;margin:0 0 16px;">
      <div style="font-size:11px;color:#818183;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:6px;">Additional Notes</div>
      <p style="font-size:13px;color:#000;line-height:1.6;white-space:pre-line;margin:0;">${escapeHtml(trimmed)}</p>
    </div>
  `;
}

export function parseCoverageBenefitLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * "What extended coverage includes" list. Hidden when there are no benefits.
 */
export function renderCoverageListSection(benefits, title = "What extended coverage includes") {
  const lines = Array.isArray(benefits)
    ? benefits.map((line) => String(line || "").trim()).filter(Boolean)
    : parseCoverageBenefitLines(benefits);
  if (!lines.length) return "";

  const items = lines
    .map(
      (line, index) => `
        <tr>
          <td style="${index === lines.length - 1 ? "padding:7px 0;" : "border-bottom:1px solid #F1F5F9; padding:7px 0;"}">
            <table width="100%" cellspacing="0" cellpadding="0" style="width:100%;">
              <tbody>
                <tr>
                  <td width="12" style="width:12px; vertical-align:top; padding-top:3px; color:#037CC2; font-size:12px; line-height:1;">&#8250;</td>
                  <td width="10" style="width:10px;"></td>
                  <td style="font-size:12px; font-weight:400; color:#818183; line-height:19.5px;">${escapeHtml(line)}</td>
                </tr>
              </tbody>
            </table>
          </td>
        </tr>`
    )
    .join("");

  return emailSection(`
    <table width="100%" cellspacing="0" cellpadding="0" style="width:100%;">
      <tbody>
        <tr><td class="h-24" height="44" style="height:44px;"></td></tr>
        <tr>
          <td style="font-size:18px; font-weight:700; color:#037CC2; line-height:1.1;">
            ${escapeHtml(title)}
          </td>
        </tr>
        <tr><td height="10" style="height:10px;"></td></tr>
        ${items}
        <tr><td height="24" style="height:24px;"></td></tr>
      </tbody>
    </table>
  `);
}

export function renderProductCard({
  productTitle,
  serialNumber,
  badges = [],
  serialLabel = "Serial number",
}) {
  const badgeHtml = (badges || [])
    .filter((badge) => badge?.label)
    .map((badge) => {
      const isWarning = badge.tone === "warning";
      const bg = isWarning ? "#fff6e6" : "#EFFFEF";
      const color = isWarning ? "#905D04" : "#008935";
      return `
        <span style="display:inline-block; background-color:${bg}; padding:4px 8px; border-radius:20px; color:${color}; font-size:12px; font-weight:400; line-height:1; white-space:nowrap; margin:0 8px 6px 0;">
          ${escapeHtml(badge.label)}
        </span>`;
    })
    .join("");

  return emailSection(`
    <table width="100%" cellspacing="0" cellpadding="0" style="width:100%; background-color:#F0F4F9; border-radius:10px;">
      <tbody>
        <tr>
          <td width="20" style="width:20px;"></td>
          <td>
            <table width="100%" cellspacing="0" cellpadding="0" style="width:100%;">
              <tbody>
                <tr><td height="20" style="height:20px;"></td></tr>
                <tr>
                  <td style="font-size:16px; font-weight:500; line-height:1.2; color:#000000;">
                    ${escapeHtml(productTitle || "")}
                  </td>
                </tr>
                ${
                  serialNumber
                    ? `
                <tr><td height="4" style="height:4px;"></td></tr>
                <tr>
                  <td style="font-size:12px; font-weight:400; line-height:1.2; color:#000000;">
                    ${escapeHtml(serialLabel)} : ${escapeHtml(serialNumber)}
                  </td>
                </tr>`
                    : ""
                }
                ${
                  badgeHtml
                    ? `
                <tr><td height="8" style="height:8px;"></td></tr>
                <tr><td>${badgeHtml}</td></tr>`
                    : ""
                }
                <tr><td height="20" style="height:20px;"></td></tr>
              </tbody>
            </table>
          </td>
          <td width="20" style="width:20px;"></td>
        </tr>
      </tbody>
    </table>
  `);
}

function detailCell(label, value, { borderRight = true, borderBottom = true } = {}) {
  const border = [
    borderBottom ? "border-bottom:1px solid #D4D7E3;" : "",
    borderRight ? "border-right:1px solid #D4D7E3;" : "",
  ].join(" ");
  return `
    <td width="50%" style="width:50%; padding:14px 18px; ${border} vertical-align:top;">
      <div style="font-size:11px; color:#818183; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; margin-bottom:4px;">
        ${escapeHtml(label)}
      </div>
      <div style="font-size:14px; color:#000; font-weight:600;">
        ${escapeHtml(value || "—")}
      </div>
    </td>
  `;
}

/**
 * 2×2 warranty / details table used by standard warranty (and similar) emails.
 * `cells` is [{ label, value }, ...] in row-major order.
 */
export function renderDetailsGrid(cells = []) {
  const items = (cells || []).filter((cell) => cell?.label);
  if (!items.length) return "";

  const rows = [];
  for (let i = 0; i < items.length; i += 2) {
    const left = items[i];
    const right = items[i + 1];
    const isLastRow = i + 2 >= items.length;
    rows.push(`
      <tr>
        ${detailCell(left.label, left.value, {
          borderRight: Boolean(right),
          borderBottom: !isLastRow || Boolean(right),
        })}
        ${
          right
            ? detailCell(right.label, right.value, {
                borderRight: false,
                borderBottom: !isLastRow,
              })
            : `<td width="50%" style="width:50%;"></td>`
        }
      </tr>
    `);
  }

  return `
    <table width="100%" cellspacing="0" cellpadding="0" style="width:100%; border:1px solid #D4D7E3; border-radius:4px; border-collapse:separate; overflow:hidden;">
      <tbody>
        ${rows.join("")}
      </tbody>
    </table>
  `;
}

function isFeaturedPlan(plan) {
  const badge = String(plan.badgeLabel || plan.merchandisingBadge || "").toLowerCase();
  if (plan.featured) return true;
  if (badge.includes("popular")) return true;
  return Boolean(plan.badgeLabel);
}

function planPriceLabel(plan) {
  if (plan.price && /[A-Za-z$€£¥₹]/.test(String(plan.price))) {
    return String(plan.price);
  }
  return [plan.price, plan.currency].filter(Boolean).join(" ") || "—";
}

function renderPlanCard(plan, featured, coveragePrefix = "Coverage") {
  const title =
    plan.planName ||
    plan.title ||
    (plan.durationYears ? `+${plan.durationYears} Year` : "");
  const start = formatEmailDisplayDate(plan.startDate || plan.extendedWarrantyStartDate);
  const end = formatEmailDisplayDate(plan.endDate || plan.extendedWarrantyEndDate);
  const coverage =
    start && end ? `${coveragePrefix}: ${start} \u2013 ${end}` : start || end || "";
  const badgeLabel = plan.badgeLabel || "";

  const inner = `
    <table width="100%" cellspacing="0" cellpadding="0" style="width:100%;">
      <tbody>
        <tr>
          <td width="20" style="width:20px;"></td>
          <td>
            <table width="100%" cellspacing="0" cellpadding="0" style="width:100%;">
              <tbody>
                <tr><td height="${featured ? "2" : "18"}" style="height:${featured ? "2" : "18"}px;"></td></tr>
                <tr>
                  <td style="font-size:20px; font-weight:500; color:#000000; line-height:1;">
                    ${escapeHtml(title)}
                  </td>
                </tr>
                <tr><td height="12" style="height:12px;"></td></tr>
                <tr>
                  <td>
                    <table width="100%" cellspacing="0" cellpadding="0" style="width:100%;">
                      <tbody>
                        <tr>
                          <td width="16" style="width:16px; vertical-align:middle; color:#037CC2; font-size:14px;">&#10003;</td>
                          <td width="8" style="width:8px;"></td>
                          <td style="vertical-align:middle; color:#818183; font-size:14px; font-weight:400; line-height:1.25;">
                            ${escapeHtml(coverage)}
                          </td>
                          <td class="plan-price" style="text-align:right; vertical-align:middle; white-space:nowrap; padding-left:12px; font-size:18px; font-weight:700; color:#000000;">
                            ${escapeHtml(planPriceLabel(plan))}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
                <tr><td height="18" style="height:18px;"></td></tr>
              </tbody>
            </table>
          </td>
          <td width="20" style="width:20px;"></td>
        </tr>
      </tbody>
    </table>
  `;

  return `
    <table width="100%" cellspacing="0" cellpadding="0" style="width:100%; border:1px solid #D4D7E3; border-radius:4px; border-collapse:separate; background-color:#ffffff;">
      <tbody>
        ${
          featured && badgeLabel
            ? `
        <tr>
          <td align="right" style="text-align:right; font-size:0; line-height:0; padding:0;">
            <span style="display:inline-block; background-color:#037CC2; padding:5px 8px; border-radius:20px 2px 0 20px; color:#ffffff; font-size:12px; font-weight:500; line-height:1; white-space:nowrap;">
              ${escapeHtml(badgeLabel)}
            </span>
          </td>
        </tr>`
            : ""
        }
        <tr>
          <td>${inner}</td>
        </tr>
      </tbody>
    </table>
  `;
}

/**
 * Extended-warranty plan picker. Hidden when `plans` is empty.
 */
export function renderExtendedCoveragePlans({
  plans = [],
  ctaHref = "",
  ctaLabel = "Extend my warranty",
  title = "Choose your Extended Coverage",
  coveragePrefix = "Coverage",
}) {
  if (!plans.length) return "";

  const cards = plans
    .map((plan, index) => {
      const featured = isFeaturedPlan(plan);
      return `
        <tr>
          <td>${renderPlanCard(plan, featured, coveragePrefix)}</td>
        </tr>
        <tr><td height="10" style="height:10px;"></td></tr>
      `;
    })
    .join("");

  const cta = ctaHref
    ? `
      <tr>
        <td align="center" style="text-align:center;">
          ${emailButton({ href: ctaHref, label: ctaLabel })}
        </td>
      </tr>`
    : "";

  return emailSection(`
    <table width="100%" cellspacing="0" cellpadding="0" style="width:100%;">
      <tbody>
        <tr><td class="h-24" height="44" style="height:44px;"></td></tr>
        <tr>
          <td style="font-size:18px; font-weight:700; color:#037CC2; line-height:1.1;">
            ${escapeHtml(title)}
          </td>
        </tr>
        <tr><td height="10" style="height:10px;"></td></tr>
        ${cards}
        <tr><td height="20" style="height:20px;"></td></tr>
        ${cta}
        <tr><td height="24" style="height:24px;"></td></tr>
        <tr>
          <td height="1" style="height:1px; background-color:#D4D7E3; font-size:0; line-height:0;">&nbsp;</td>
        </tr>
      </tbody>
    </table>
  `);
}

export function renderGreeting({ name, introHtml, salutation }) {
  const greetingName = escapeHtml(name || "Customer");
  const line = salutation || `Hi ${greetingName},`;
  return emailSection(`
    <table width="100%" cellspacing="0" cellpadding="0" style="width:100%;">
      <tbody>
        <tr><td class="h-30" height="40" style="height:40px;"></td></tr>
        <tr>
          <td style="font-size:14px; font-weight:400; line-height:1.3; color:#000000;">
            ${line}
          </td>
        </tr>
        ${
          introHtml
            ? `
        <tr><td height="6" style="height:6px;"></td></tr>
        <tr>
          <td style="font-size:14px; font-weight:400; line-height:1.3; color:#000000;">
            ${introHtml}
          </td>
        </tr>`
            : ""
        }
        <tr><td height="24" style="height:24px;"></td></tr>
      </tbody>
    </table>
  `);
}

export function renderCtaBlock({ href, label, noteHtml = "" }) {
  if (!href && !noteHtml) return "";
  return emailSection(`
    <table width="100%" cellspacing="0" cellpadding="0" style="width:100%;">
      <tbody>
        <tr><td height="20" style="height:20px;"></td></tr>
        ${
          href
            ? `<tr><td align="center" style="text-align:center;">${emailButton({
                href,
                label,
              })}</td></tr>`
            : ""
        }
        ${noteHtml ? `<tr><td height="8" style="height:8px;"></td></tr><tr><td>${noteHtml}</td></tr>` : ""}
        <tr><td height="20" style="height:20px;"></td></tr>
      </tbody>
    </table>
  `);
}

function renderHero(hero) {
  if (!hero) return "";
  return `
    <tr>
      <td bgcolor="#1c3c4e" style="background-color:#1c3c4e; background-image:linear-gradient(114.41deg, #1c3c4e 0.74%, #037CC2 100%);">
        <table width="100%" cellspacing="0" cellpadding="0" style="width:100%;">
          <tbody>
            <tr>
              <td class="w-30" width="40" style="width:40px;"></td>
              <td>
                <table width="100%" cellspacing="0" cellpadding="0" style="width:100%; display:"flex; justify-content:center; align-items:center;">
                  <tbody>
                    <tr><td height="30" style="height:30px;"></td></tr>
                    ${
                      hero.badge
                        ? `
                    <tr>
                      <td>
                        <span style="display:inline-block; background-color:#EFFFEF; padding:5px 8px 4px; border-radius:20px; color:#008935; font-size:12px; font-weight:400; white-space:nowrap; line-height:1;">
                          ${escapeHtml(hero.badge)}
                        </span>
                      </td>
                    </tr>
                    <tr><td height="10" style="height:10px;"></td></tr>`
                        : ""
                    }
                    <tr>
                      <td class="hero-title" bgcolor="#1c3c4e" style="background-color:#1c3c4e; color:#ffffff; font-size:23px; font-weight:600; line-height:1.25; display:flex; justify-content:center; align-items:center;">
                        ${hero.titleHtml || escapeHtml(hero.title || "")}
                      </td>
                    </tr>
                    ${
                      hero.subtitle
                        ? `
                    <tr><td height="8" style="height:8px;"></td></tr>
                    <tr>
                      <td style="color:#ffffff; font-size:12px; font-weight:400; line-height:1.67;">
                        ${hero.subtitleHtml || escapeHtml(hero.subtitle)}
                      </td>
                    </tr>`
                        : ""
                    }
                    ${
                      hero.expiry
                        ? `
                    <tr><td height="10" style="height:10px;"></td></tr>
                    <tr>
                      <td>
                        <span style="display:inline-block; background-color:#037CC2; padding:4px 8px; border-radius:4px; color:#ffffff; font-size:12px; font-weight:500; white-space:nowrap;">
                          ${escapeHtml(hero.expiry)}
                        </span>
                      </td>
                    </tr>`
                        : ""
                    }
                    <tr><td height="30" style="height:30px;"></td></tr>
                  </tbody>
                </table>
              </td>
              <td class="w-30" width="40" style="width:40px;"></td>
            </tr>
          </tbody>
        </table>
      </td>
    </tr>
  `;
}

function continueShoppingSection(storeUrl, labels = {}) {
  const href = safeHref(storeUrl);
  if (!href) return "";

  const label = labels.continueShopping || "Continue shopping";

  return emailSection(`
    <table width="100%" cellspacing="0" cellpadding="0" style="width:100%;">
      <tbody>
        <tr>
          <td
            align="center"
            style="text-align:center; font-size:14px; font-weight:400; line-height:normal;"
          >
            <a
              href="${escapeHtml(href)}"
              class="custom-link"
              style="color:#037CC2; text-decoration:underline;"
              title="${escapeHtml(label)}"
            >
              ${escapeHtml(label)}
            </a>
          </td>
        </tr>

        <tr>
          <td height="24" style="height:24px;"></td>
        </tr>
      </tbody>
    </table>
  `);
}

function renderAfterContinueShopping({
  extraContentHtml = "",
  supportUrl = "",
  signOff = "",
  labels = {},
} = {}) {
  const extra = String(extraContentHtml || "").trim();
  const safeSupportUrl = safeHref(supportUrl);
  const supportMessage =
    labels.supportMessage ||
    "If you have any questions about extended coverage, our support team is happy to help.";
  const supportLinkLabel = labels.supportLink || "Visit our support centre →";

  const supportLinkHtml = safeSupportUrl
    ? `
      <tr>
        <td height="14" style="height:14px;"></td>
      </tr>
      <tr>
        <td
          style="
            padding:0 40px;
            font-size:14px;
            font-weight:500;
            line-height:1.5;
          "
        >
          <a
            href="${escapeHtml(safeSupportUrl)}"
            class="custom-link"
            style="color:#037CC2; text-decoration:underline;"
            title="${escapeHtml(supportLinkLabel)}"
          >
            ${escapeHtml(supportLinkLabel)}
          </a>
        </td>
      </tr>
    `
    : "";

  return `
    <tr>
      <td>
        <table
          width="100%"
          cellspacing="0"
          cellpadding="0"
          style="width:100%;"
        >
          <tbody>

            ${
              extra
                ? `
            <tr>
              <td
                style="
                  padding:0 40px;
                  font-size:14px;
                  color:#000000;
                  line-height:1.5;
                "
              >
                ${extra}
              </td>
            </tr>

            <tr>
              <td height="24" style="height:24px;"></td>
            </tr>
            `
                : ""
            }

            <tr>
              <td style="padding:0 40px;">
                ${ADMIN_EMAIL_EXTRA_MARKER}
              </td>
            </tr>

            <tr>
              <td style="padding:0 40px;">
                <div
                  style="
                    height:1px;
                    background-color:#D4D7E3;
                    font-size:0;
                    line-height:0;
                  "
                ></div>
              </td>
            </tr>

            <tr>
              <td height="24" style="height:24px;"></td>
            </tr>

            <!-- Support message -->
            <tr>
              <td
                style="
                  padding:0 40px;
                  font-size:12px;
                  font-weight:400;
                  color:#818183;
                  line-height:1.5;
                "
              >
                ${escapeHtml(supportMessage)}
              </td>
            </tr>

            ${supportLinkHtml}

            <tr>
              <td height="24" style="height:24px;"></td>
            </tr>

            <!-- Team -->
            <tr>
              <td
                style="
                  padding:0 40px;
                  font-size:14px;
                  font-weight:700;
                  color:#037CC2;
                  line-height:1.4;
                "
              >
                ${escapeHtml(String(signOff || "").trim() || "The Sennheiser Team")}
              </td>
            </tr>

            <tr>
              <td height="24" style="height:24px;"></td>
            </tr>

          </tbody>
        </table>
      </td>
    </tr>
  `;
}

function legalLink(href, label) {
  const safe = safeHref(href);
  if (!safe) return "";
  return `<a class="no-underline" href="${escapeHtml(safe)}" style="color:#ffffff; text-decoration:none;">${escapeHtml(label)}</a>`;
}

function renderLegalLinks({ privacyUrl, termsUrl, labels = {} }) {
  const parts = [
    legalLink(privacyUrl, labels.privacy || "Privacy Policy"),
    legalLink(termsUrl, labels.terms || "Terms & Conditions"),
  ].filter(Boolean);
  if (!parts.length) return "";
  return parts.join("&nbsp;&nbsp;&#183;&nbsp;&nbsp;");
}

function layoutStyles() {
  return `
    body {
      margin: 0;
      padding: 0;
      color: #000;
      background-color: #ffffff;
      font-size: 14px;
      line-height: 1.4;
      -webkit-print-color-adjust: exact;
      font-family: Arial, Helvetica, sans-serif;
    }
    img { border: 0; outline: none; max-width: 100%; display: block; }
    a { cursor: pointer; color: inherit; text-decoration: none; }
    table { border-collapse: collapse; width: 100%; }
    td { line-height: 1.4; }
    .custom-link { text-decoration: underline; }
    .no-underline { text-decoration: none; }
    @media (hover: hover) {
      .custom-link:hover { text-decoration: none !important; }
      .no-underline:hover { text-decoration: underline !important; }
    }
    @media (max-width: 600px) {
      .w-full { width: 100% !important; }
      .w-30 { width: 20px !important; }
      .logo { width: 160px !important; height: auto !important; }
      .hero-title { font-size: 20px !important; }
      .plan-price { font-size: 15px !important; }
    }
  `;
}

/**
 * Shared Sennheiser transactional chrome: header, optional hero, body, footer.
 * `storeUrl`, `privacyUrl`, and `termsUrl` must come from the current shop's
 * Global URLs settings.
 */
export function renderEmailLayout({
  heading,
  bodyHtml,
  storeName = "Sennheiser Consumer Hearing",
  hero = undefined,
  footerNotice = "",
  footerExpiry = "",
  storeUrl = "",
  privacyUrl = "",
  termsUrl = "",
  supportUrl = "",
  showContinueShopping = true,
  afterContinueHtml = "",
  additionalContentHtml = "",
  signOff = "",
  labels = {},
  hideFooterStoreName = false,
}) {
  const resolvedHero =
    hero === undefined ? { title: heading || "" } : hero;
  const headerHref = safeHref(storeUrl);
  const headerOpen = headerHref
    ? `<a href="${escapeHtml(headerHref)}" title="Sennheiser" style="text-decoration:none;">`
    : "<span>";
  const headerClose = headerHref ? "</a>" : "</span>";
  const legalLinks = renderLegalLinks({ privacyUrl, termsUrl, labels });
  const appBaseUrl = safeHref(process.env.SHOPIFY_APP_URL || process.env.HOST || "");
  const logoSrc = `${appBaseUrl.replace(/\/$/, "")}/email-assets/sennheiser-logo.png`;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no" />
  <title>${escapeHtml(heading || "")}</title>
  <style>${layoutStyles()}</style>
</head>
<body style="margin:0; padding:0; background-color:#ffffff; font-family:Arial, Helvetica, sans-serif;">
  <table width="100%" cellspacing="0" cellpadding="0" style="width:100%; background-color:#ffffff;" bgcolor="#ffffff">
    <tr>
      <td align="center">
        <table class="w-full" width="600" cellspacing="0" cellpadding="0" style="width:600px; background:#ffffff; overflow:hidden;">
          <tr>
            <td bgcolor="#037CC2" style="background-color:#037CC2;">
              <table width="100%" cellspacing="0" cellpadding="0" style="width:100%;">
                <tbody>
                  <tr>
                    <td width="16" style="width:16px;"></td>
                    <td>
                      <table width="100%" cellspacing="0" cellpadding="0" style="width:100%;">
                        <tbody>
                          <tr><td height="16" style="height:16px;"></td></tr>
                          <tr>
                            <td align="center">
                              ${headerOpen}
                                <span class="logo" style="text-transform:uppercase; letter-spacing:1.6px; font-size:24px; line-height:1; font-weight:600; color:#fff; display:block;">Sennheiser</span>
                              ${headerClose}
                            </td>
                          </tr>
                          <tr><td height="16" style="height:16px;"></td></tr>
                        </tbody>
                      </table>
                    </td>
                    <td width="16" style="width:16px;"></td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>

          ${renderHero(resolvedHero)}
          ${normalizeBodyRows(bodyHtml)}
          ${showContinueShopping ? continueShoppingSection(storeUrl, labels) : ""}

          ${
            afterContinueHtml ||
            renderAfterContinueShopping({
              extraContentHtml: additionalContentHtml,
              supportUrl,
              signOff,
              labels,
            })
          }

          <tr>
            <td bgcolor="#037CC2" style="background-color:#037CC2;">
              <table width="100%" cellspacing="0" cellpadding="0" style="width:100%;">
                <tbody>
                  <tr>
                    <td class="w-30" width="40" style="width:40px;"></td>
                    <td>
                      <table width="100%" cellspacing="0" cellpadding="0" style="width:100%;">
                        <tbody>
                          <tr><td height="24" style="height:24px;"></td></tr>
                          ${
                          !hideFooterStoreName
                            ? `
                              <tr>
                                <td style="font-size:12px; font-weight:700; color:#ffffff; line-height:normal;">
                                  ${escapeHtml(storeName || "Sennheiser Consumer Hearing")}
                                </td>
                              </tr>
                            `
                            : ""
                        }
                          ${
                            footerNotice
                              ? `
                          <tr><td height="7" style="height:7px;"></td></tr>
                          <tr>
                            <td style="font-size:12px; font-weight:400; color:#ffffff; line-height:1.65;">
                              ${footerNotice}
                            </td>
                          </tr>`
                              : ""
                          }
                          ${
                            footerExpiry
                              ? `
                          <tr><td height="10" style="height:10px;"></td></tr>
                          <tr>
                            <td style="font-size:12px; font-weight:400; color:#ffffff; line-height:1.65;">
                              ${footerExpiry}
                            </td>
                          </tr>`
                              : ""
                          }
                          ${
                            legalLinks
                              ? `
                          <tr><td height="20" style="height:20px;"></td></tr>
                          <tr>
                            <td style="font-size:10px; font-weight:400; color:#ffffff; line-height:2;">
                              ${legalLinks}
                            </td>
                          </tr>`
                              : ""
                          }
                          <tr><td height="20" style="height:20px;"></td></tr>
                          <tr>
                            <td style="font-size:10px; font-weight:400; color:#ffffff; line-height:2;">
                              &#169; ${new Date().getFullYear()} ${escapeHtml(labels.copyright || "Sonova Consumer Hearing GmbH. All rights reserved.")}
                            </td>
                          </tr>
                          <tr><td height="24" style="height:24px;"></td></tr>
                        </tbody>
                      </table>
                    </td>
                    <td class="w-30" width="40" style="width:40px;"></td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}