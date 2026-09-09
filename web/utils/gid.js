// Extracts the numeric id from a Shopify GID or raw id value.
export function getNumericIdFromGid(gid) {
  if (gid == null || gid === "") return null;
  const numeric = Number(String(gid).split("/").pop());
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}
