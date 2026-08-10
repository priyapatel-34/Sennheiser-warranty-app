/** Locale-aware money formatting — never hardcode currency symbols. */
/**
 * Formats money values for the admin UI and customer-facing previews without
 * hardcoding a currency symbol or locale-specific formatting rule.
 */
export function formatMoney(amount, currency, locale) {
    if (amount == null || amount === "") return "";
    try {
      return new Intl.NumberFormat(locale || undefined, {
        style: "currency",
        currency: currency || "USD",
      }).format(Number(amount));
    } catch {
      return `${Number(amount).toFixed(2)} ${currency || ""}`.trim();
    }
  }
