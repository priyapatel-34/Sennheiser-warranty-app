(() => {
  const EW_TYPE = "extended_warranty";
  const IMAGE_PROP = "_parent_image_url";
  let refreshTimer = null;

  async function fetchCart() {
    try {
      const res = await fetch("/cart.js", { credentials: "same-origin" });
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  }

  function buildImageMap(cart) {
    const map = new Map();
    for (const item of cart?.items || []) {
      const props = item.properties || {};
      if (props._ew_type !== EW_TYPE) continue;
      const url = props[IMAGE_PROP];
      if (!url) continue;
      map.set(String(item.key), url);
      map.set(String(item.variant_id), url);
    }
    return map;
  }

  function setImageSrc(img, url) {
    if (!img || !url || img.dataset.ewImageApplied === url) return;
    img.src = url;
    img.srcset = "";
    img.dataset.ewImageApplied = url;
  }

  function applyImages(imageMap) {
    if (!imageMap.size) return;

    document.querySelectorAll("[data-cart-item-key]").forEach(row => {
      const key = row.getAttribute("data-cart-item-key");
      const url = imageMap.get(key);
      if (url) row.querySelectorAll("img").forEach(img => setImageSrc(img, url));
    });

    document.querySelectorAll("[data-variant-id]").forEach(el => {
      const variantId = el.getAttribute("data-variant-id");
      const url = imageMap.get(variantId);
      if (url) el.querySelectorAll("img").forEach(img => setImageSrc(img, url));
    });

    imageMap.forEach((url, key) => {
      if (!key.includes(":")) return;
      document
        .querySelectorAll(`a[href*="${encodeURIComponent(key)}"]`)
        .forEach(link => {
          const container = link.closest(
            ".cart-item, .cart__item, .mini-cart__item, tr, li, [class*='cart']"
          );
          container?.querySelectorAll("img").forEach(img => setImageSrc(img, url));
        });
    });
  }

  async function refreshCartImages() {
    const cart = await fetchCart();
    applyImages(buildImageMap(cart));
  }

  function scheduleRefresh() {
    if (refreshTimer) window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(refreshCartImages, 120);
  }

  function init() {
    refreshCartImages();
    document.addEventListener("cart:updated", scheduleRefresh);
    document.addEventListener("cart:refresh", scheduleRefresh);
    document.addEventListener("theme:cart:change", scheduleRefresh);

    new MutationObserver(scheduleRefresh).observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
