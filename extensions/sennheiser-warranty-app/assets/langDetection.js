function normalizeLangCode(lang) {
  const code = String(lang || "")
    .trim()
    .split("-")[0]
    .toLowerCase();

  return /^[a-z]{2}$/.test(code) ? code : "en";
}

window.getCurrentStorefrontLocale = function () {
  const raw =
    (window.Weglot &&
      typeof window.Weglot.getCurrentLang === "function"
      ? window.Weglot.getCurrentLang()
      : "") ||
    document.getElementById("storefrontLocale")?.value?.trim() ||
    window.Shopify?.locale ||
    document.documentElement.lang ||
    navigator.language ||
    "en";

  return normalizeLangCode(raw);
};