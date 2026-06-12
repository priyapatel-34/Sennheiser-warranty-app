/** Locale-aware money formatting — never hardcode currency symbols. */
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
