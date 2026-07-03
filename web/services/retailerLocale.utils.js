/** ISO 639-1 base code from a locale string (e.g. en-IN -> en, pt-BR -> pt). */
export function normalizeLangCode(lang) {
  const code = String(lang || "en").trim().split("-")[0].toLowerCase();
  return /^[a-z]{2}$/.test(code) ? code : "en";
}

/** English storefronts search canonical names; all other languages use the store-localized column. */
export function usesLocalizedRetailerSearch(lang) {
  return normalizeLangCode(lang) !== "en";
}

export function retailerSearchColumn(lang) {
  return usesLocalizedRetailerSearch(lang)
    ? "retailer_name_ja"
    : "retailer_name";
}
