(() => {
  if (window.__SENNH_EW_PDP_NESTED__) return;
  window.__SENNH_EW_PDP_NESTED__ = true;

  const PROXY_OFFER = "/apps/warranty/extended-warranty/pdp-offer";
  const PROXY_CART = "/apps/warranty/extended-warranty/pdp-cart-payload";
  const NONE_PLAN_ID = "none";

  const widgets = new Map();
  let cartHookInstalled = false;
  let variantWatchInstalled = false;
  let nativeFetch = typeof window.fetch === "function" ? window.fetch.bind(window) : null;
  let ewInternal = false;
  let reconciling = false;

  function escapeHtml(str) {
    if (str == null || str === "") return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function shopifyRoot() {
    return window.Shopify?.routes?.root || "/";
  }

  function cartEndpoint(name) {
    return `${shopifyRoot()}cart/${name}`.replace(/([^:]\/)\/+/g, "$1");
  }

  function isEwDebugEnabled() {
    try {
      if (window.__EW_PDP_DEBUG) return true;
      if (window.Shopify?.designMode) return true;
      return new URLSearchParams(window.location.search).get("ew_debug") === "1";
    } catch {
      return false;
    }
  }

  function ewLog(...args) {
    console.log(...args);
  }

  function ewDebug(...args) {
    if (isEwDebugEnabled()) console.log(...args);
  }

  function formatPrice(price, currency) {
    if (price == null || price === "") return "";
    try {
      return new Intl.NumberFormat(document.documentElement.lang || undefined, {
        style: "currency",
        currency: currency || "USD",
      }).format(Number(price));
    } catch {
      return `${Number(price).toFixed(2)} ${currency || ""}`.trim();
    }
  }

  function parseCoverageLines(text) {
    return String(text || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function isTwoYearPlan(plan) {
    return (
      plan.durationMonths === 24 ||
      plan.durationYears === 2 ||
      /\+?\s*2\s*(yr|year)/i.test(plan.planName || "")
    );
  }

  function defaultPlanId(plans) {
    const twoYear = plans.find(isTwoYearPlan);
    return twoYear?.planId ?? plans[0]?.planId ?? null;
  }

  function parseVariants(root) {
    try {
      const node = root.querySelector("[data-ew-pdp-variants]");
      return node ? JSON.parse(node.textContent || "[]") : [];
    } catch {
      return [];
    }
  }

  function variantFromForm(productId) {
    const forms = document.querySelectorAll('form[action*="/cart/add"]');
    for (const form of forms) {
      const idInput = form.querySelector('[name="id"]');
      if (!idInput?.value) continue;
      if (productId && form.querySelector(`[data-productid="${productId}"]`)) {
        return idInput.value;
      }
      if (forms.length === 1) return idInput.value;
    }
    const fallback = document.querySelector('form[action*="/cart/add"] [name="id"]');
    return fallback?.value || null;
  }

  function variantFromUrl() {
    const value = new URLSearchParams(window.location.search).get("variant");
    return value ? Number(value) : null;
  }

  /**
   * Horizon updates ?variant= and may fire variant:update. Liquid does not
   * re-render the app block, so the live form input is the add-to-cart source
   * of truth when present.
   */
  function resolveCurrentVariantId(state) {
    const formId = variantFromForm(state.productId);
    if (formId) return Number(formId);
    const urlId = variantFromUrl();
    if (urlId) return urlId;
    return Number(state.variantId);
  }

  function applyVariantMeta(state, variantId) {
    const meta = state.variants.find((item) => Number(item.id) === Number(variantId));
    state.variantId = Number(variantId);
    if (meta) {
      state.sku = meta.sku || state.sku;
      state.variantTitle = meta.title || state.variantTitle;
      if (meta.image) state.productImage = meta.image;
    }
  }

  function labelFor(root, key, fallback) {
    return root.dataset[key] || fallback;
  }

  function renderStatus(state, message, isError) {
    state.root.hidden = false;
    state.root.innerHTML = `<p class="ew-pdp__status${isError ? " is-error" : ""}">${escapeHtml(message)}</p>`;
  }

  function providerMarkup(state, className) {
    const logo = state.providerLogo;
    const name = state.providerName;
    return logo
      ? `<span class="${className}"><img src="${escapeHtml(logo)}" alt="${escapeHtml(name)}"></span>`
      : `<span class="${className}">${escapeHtml(name)}</span>`;
  }

  function renderWidget(state) {
    const plans = state.offer?.plans || [];
    if (!plans.length) {
      state.root.hidden = true;
      state.root.innerHTML = "";
      return;
    }

    const heading = labelFor(state.root, "heading", "Add Extended Warranty");
    const coveredLabel = labelFor(state.root, "whatsCoveredLabel", "What's covered?");
    const showCovered = state.root.dataset.showWhatsCovered !== "false";
    const currency = state.offer.currency;

    const cards = plans
      .map((plan) => {
        const selected = String(state.selectedPlanId) === String(plan.planId);
        const badge = plan.badgeLabel
          ? `<span class="ew-pdp__badge">${escapeHtml(plan.badgeLabel)}</span>`
          : "";
        return `
          <button
            type="button"
            class="ew-pdp__card${selected ? " is-selected" : ""}"
            data-ew-plan-id="${escapeHtml(plan.planId)}"
            aria-pressed="${selected ? "true" : "false"}"
          >
            ${badge}
            <span class="ew-pdp__card-name">${escapeHtml(plan.planName)}</span>
            <span class="ew-pdp__card-price">${escapeHtml(formatPrice(plan.price, plan.currency || currency))}</span>
          </button>
        `;
      })
      .join("");

    state.root.hidden = false;
    state.root.innerHTML = `
      <div class="ew-pdp__header">
        <h3 class="ew-pdp__heading">${escapeHtml(heading)}</h3>
        ${
          showCovered
            ? `<button type="button" class="ew-pdp__covered-link" data-ew-open-modal>${escapeHtml(coveredLabel)}</button>`
            : ""
        }
        ${providerMarkup(state, "ew-pdp__brand")}
      </div>
      <div class="ew-pdp__plans">${cards}</div>
    `;
  }

  function ensureModal(state) {
    if (state.modal) return state.modal;
    const modal = document.createElement("div");
    modal.className = "ew-pdp-modal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="ew-pdp-modal__backdrop" data-ew-close-modal></div>
      <div class="ew-pdp-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="ew-pdp-modal-title-${state.root.dataset.blockId}">
        <button type="button" class="ew-pdp-modal__close" data-ew-close-modal aria-label="Close">×</button>
        <div class="ew-pdp-modal__left"></div>
        <div class="ew-pdp-modal__right"></div>
        <div class="ew-pdp-modal__footer"></div>
      </div>
    `;
    document.body.appendChild(modal);
    state.modal = modal;
    return modal;
  }

  function renderModal(state) {
    const modal = ensureModal(state);
    const offer = state.offer;
    const plans = offer?.plans || [];
    const coverage = parseCoverageLines(offer?.settings?.coverageText);
    const draftId = state.modalPlanId ?? state.selectedPlanId ?? NONE_PLAN_ID;
    const noneLabel = labelFor(state.root, "noneLabel", "No Extended Coverage");
    const saveLabel = labelFor(state.root, "saveLabel", "SAVE");
    const termsLabel = labelFor(state.root, "termsLabel", "Detailed Terms And Conditions");
    const footerNote = labelFor(
      state.root,
      "footerNote",
      "Let us handle the worries, and you enjoy your purchase!"
    );
    const trustLabel = labelFor(state.root, "trustLabel", "Trusted by 100K+ customers");
    const currency = offer?.currency;
    const termsUrl = offer?.settings?.termsUrl;

    const coverageHtml = coverage.length
      ? `<ul class="ew-pdp-modal__coverage">${coverage
          .map((line) => `<li>${escapeHtml(line)}</li>`)
          .join("")}</ul>`
      : `<p class="ew-pdp__status">Coverage details are listed in the terms and conditions.</p>`;

    const planButtons = [
      ...plans.map((plan) => {
        const selected = String(draftId) === String(plan.planId);
        const badge = plan.badgeLabel
          ? `<span class="ew-pdp-modal__plan-badge">${escapeHtml(plan.badgeLabel)}</span>`
          : "";
        return `
          <button type="button" class="ew-pdp-modal__plan${selected ? " is-selected" : ""}" data-ew-modal-plan="${escapeHtml(plan.planId)}" aria-pressed="${selected ? "true" : "false"}">
            ${badge}
            <span class="ew-pdp-modal__plan-name">${escapeHtml(plan.planName)}</span>
            <span class="ew-pdp-modal__plan-price">${escapeHtml(formatPrice(plan.price, plan.currency || currency))}</span>
          </button>
        `;
      }),
      `<button type="button" class="ew-pdp-modal__plan${String(draftId) === NONE_PLAN_ID ? " is-selected" : ""}" data-ew-modal-plan="${NONE_PLAN_ID}" aria-pressed="${String(draftId) === NONE_PLAN_ID ? "true" : "false"}">
        <span class="ew-pdp-modal__plan-name">${escapeHtml(noneLabel)}</span>
        <span class="ew-pdp-modal__plan-price"></span>
      </button>`,
    ].join("");

    const shopLogo = state.root.dataset.shopLogo;

    modal.querySelector(".ew-pdp-modal__left").innerHTML = `
      <h2 class="ew-pdp-modal__kicker" id="ew-pdp-modal-title-${state.root.dataset.blockId}">What's Included?</h2>
      ${coverageHtml}
      <div class="ew-pdp-modal__trust">
        <div class="ew-pdp-modal__stars" aria-hidden="true">★★★★★</div>
        <p class="ew-pdp-modal__trust-text">${escapeHtml(trustLabel)}</p>
        <div class="ew-pdp-modal__brands">
          ${
            shopLogo
              ? `<img src="${escapeHtml(shopLogo)}" alt="${escapeHtml(state.shopName || "Store")}">`
              : `<span>${escapeHtml(state.shopName || "SENNHEISER")}</span>`
          }
        </div>
      </div>
    `;

    modal.querySelector(".ew-pdp-modal__right").innerHTML = `
      <div class="ew-pdp-modal__product">
        <h3 class="ew-pdp-modal__product-title">${escapeHtml(state.productTitle)}</h3>
        ${
          state.productImage
            ? `<img src="${escapeHtml(state.productImage)}" alt="${escapeHtml(state.productTitle)}">`
            : ""
        }
      </div>
      <p class="ew-pdp-modal__select-label">Select a coverage plan</p>
      <div class="ew-pdp-modal__plan-list">${planButtons}</div>
      <button type="button" class="ew-pdp-modal__save" data-ew-save>${escapeHtml(saveLabel)}</button>
    `;

    modal.querySelector(".ew-pdp-modal__footer").innerHTML = `
      <p>${escapeHtml(footerNote)}</p>
      ${
        termsUrl
          ? `<a class="ew-pdp-modal__terms" href="${escapeHtml(termsUrl)}" target="_blank" rel="noopener">${escapeHtml(termsLabel)}</a>`
          : `<span></span>`
      }
    `;
  }

  function openModal(state) {
    if (!state.offer?.eligible) return;
    state.modalPlanId = state.selectedPlanId || NONE_PLAN_ID;
    renderModal(state);
    ensureModal(state).hidden = false;
    document.body.classList.add("ew-pdp-modal-open");
  }

  function closeModal(state) {
    if (!state.modal) return;
    state.modal.hidden = true;
    document.body.classList.remove("ew-pdp-modal-open");
  }

  async function fetchOffer(state, variantId) {
    const generation = ++state.requestGeneration;
    const params = new URLSearchParams({
      product_id: String(state.productId),
      variant_id: String(variantId || ""),
    });
    if (state.sku) params.set("sku", state.sku);
    if (state.country) params.set("country", state.country);

    const response = await fetch(`${PROXY_OFFER}?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
    const data = await response.json().catch(() => ({}));
    if (generation !== state.requestGeneration) return null;
    if (!response.ok) {
      throw new Error(data.error || "Failed to load warranty plans");
    }
    return data;
  }

  async function loadForVariant(state, variantId, { keepSelection } = {}) {
    applyVariantMeta(state, variantId);
    renderStatus(state, labelFor(state.root, "loadingLabel", "Loading warranty options..."), false);

    try {
      const offer = await fetchOffer(state, variantId);
      if (!offer) return;

      state.offer = offer;
      if (!offer.eligible || !offer.plans?.length) {
        state.selectedPlanId = null;
        if (state.hasRenderedPlans) {
          renderStatus(
            state,
            labelFor(state.root, "emptyLabel", "Extended warranty is not available"),
            false
          );
        } else {
          state.root.hidden = true;
          state.root.innerHTML = "";
        }
        return;
      }

      if (
        keepSelection &&
        offer.plans.some((plan) => String(plan.planId) === String(state.selectedPlanId))
      ) {
        // Keep the customer's choice when the same plan still exists.
      } else {
        state.selectedPlanId = defaultPlanId(offer.plans);
      }

      state.hasRenderedPlans = true;
      renderWidget(state);
      if (state.modal && !state.modal.hidden) {
        state.modalPlanId = state.selectedPlanId;
        renderModal(state);
      }
    } catch (err) {
      console.warn("[EW PDP] offer failed; product purchase remains available", err);
      state.offer = null;
      state.selectedPlanId = null;
      renderStatus(state, labelFor(state.root, "errorLabel", "Warranty options could not be loaded"), true);
    }
  }

  function selectedPlan(state) {
    if (!state.selectedPlanId || state.selectedPlanId === NONE_PLAN_ID) return null;
    return (state.offer?.plans || []).find(
      (plan) => String(plan.planId) === String(state.selectedPlanId)
    );
  }

  function quantityFromContext() {
    const input = document.querySelector('form[action*="/cart/add"] [name="quantity"]');
    const value = Number(input?.value || 1);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  function normalizeQuantity(value, fallback = 1, { allowZero = false } = {}) {
    const quantity = Number(value);
    if (allowZero && quantity === 0) return 0;
    return Number.isFinite(quantity) && quantity > 0 ? quantity : fallback;
  }

  function normalizeVariantId(value) {
    if (value == null || value === "") return null;
    const raw = String(value).split("/").pop();
    const numeric = Number(raw);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
  }

  function propertyMap(item) {
    const properties = {};
    const raw = item?.properties;
    if (Array.isArray(raw)) {
      for (const entry of raw) {
        const name = entry?.name || entry?.key;
        if (name) properties[name] = entry.value;
      }
    } else if (raw && typeof raw === "object") {
      Object.assign(properties, raw);
    }
    if (item && typeof item === "object") {
      for (const [key, value] of Object.entries(item)) {
        const match = /^properties\[([^\]]+)\]$/.exec(key);
        if (match) properties[match[1]] = value;
      }
    }
    return properties;
  }

  function isWarrantyLine(item) {
    return propertyMap(item)._ew_type === "extended_warranty";
  }

  function collectProperties(item) {
    return propertyMap(item);
  }

  function getRequestItems(body) {
    if (!body) return [];
    if (Array.isArray(body)) return body;
    if (Array.isArray(body.items)) return body.items;
    if (body.id) return [body];
    return [];
  }

  function toCartLine(item) {
    const id = normalizeVariantId(item?.id ?? item?.variant_id ?? item?.variantId);
    if (!id) return null;
    const line = {
      id,
      quantity: normalizeQuantity(item.quantity, 1),
    };
    const properties = collectProperties(item);
    if (Object.keys(properties).length) line.properties = properties;
    if (item.selling_plan) line.selling_plan = item.selling_plan;
    return line;
  }

  function findParentItem(items, state) {
    const variantId = Number(state.variantId);
    return items.find((item) => {
      const itemVariantId = normalizeVariantId(item?.id ?? item?.variant_id ?? item?.variantId);
      return itemVariantId === variantId && !isWarrantyLine(item);
    });
  }

  async function fetchWarrantyPayload(state, plan) {
    const response = await fetch(PROXY_CART, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        product_id: state.productId,
        variant_id: state.variantId,
        plan_id: plan.planId,
        sku: state.sku,
        country: state.country,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.variantId) {
      throw new Error(payload.error || "Warranty payload could not be created");
    }
    return payload;
  }

  function extraCartFields(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) return {};
    const reserved = new Set(["id", "quantity", "items", "form_type", "utf8", "selling_plan"]);
    const extra = {};
    for (const [key, value] of Object.entries(body)) {
      if (reserved.has(key) || /^properties\[/.test(key)) continue;
      extra[key] = value;
    }
    return extra;
  }

  async function buildNestedCartBody(body) {
    const sourceItems = getRequestItems(body);
    if (!sourceItems.length) return null;

    const nextItems = sourceItems.map((item) => toCartLine(item)).filter(Boolean);
    if (!nextItems.length) return null;

    let warrantyAdded = false;

    for (const state of widgets.values()) {
      const plan = selectedPlan(state);
      if (!plan) continue;

      const parent = findParentItem(nextItems, state);
      if (!parent) {
        ewDebug("[EW PDP] No matching product found for warranty state", {
          variantId: state.variantId,
          selectedPlanId: state.selectedPlanId,
        });
        continue;
      }

      const payload = await fetchWarrantyPayload(state, plan);
      const parentVariantId = normalizeVariantId(
        parent.id ?? payload.parentVariantId ?? state.variantId
      );
      const warrantyVariantId = normalizeVariantId(payload.variantId);
      const productQuantity = normalizeQuantity(parent.quantity, quantityFromContext());

      ewLog("[EW PDP] Selected plan:", plan.planId, plan.planName || "");
      ewLog("[EW PDP] Product variant:", parentVariantId);
      ewLog("[EW PDP] Warranty variant:", warrantyVariantId);
      ewLog("[EW PDP] Product quantity:", productQuantity);
      ewLog("[EW PDP] Plan:", plan.planId);

      if (!parentVariantId) {
        throw new Error("Could not determine parent variant ID");
      }
      if (!warrantyVariantId) {
        throw new Error("Checkout variant not configured for this plan");
      }
      if (warrantyVariantId === parentVariantId) {
        console.error(
          "[EW PDP] Warranty variant equals product variant; aborting nested add",
          { parentVariantId, warrantyVariantId, planId: plan.planId }
        );
        throw new Error("Checkout variant not configured for this plan");
      }

      parent.quantity = productQuantity;
      parent.properties = {
        ...(parent.properties || {}),
        _ew_plan_id: String(plan.planId),
      };

      nextItems.push({
        id: warrantyVariantId,
        quantity: productQuantity,
        parent_id: parentVariantId,
        properties: {
          ...(payload.properties || {}),
          _ew_type: "extended_warranty",
          _ew_source: "pdp",
          _ew_plan_id: String(plan.planId),
          _ew_product_id: String(state.productId),
          _ew_variant_id: String(parentVariantId),
        },
      });

      warrantyAdded = true;
    }

    if (!warrantyAdded) return null;

    const nestedBody = {
      ...extraCartFields(body),
      items: nextItems,
    };

    ewLog("[EW PDP] Final nested cart payload", nestedBody);
    return nestedBody;
  }

  async function parseBodyValue(body, contentType = "") {
    if (body == null) return null;

    if (typeof body === "string") {
      const text = body.trim();
      if (!text) return null;

      if (contentType.includes("application/json") || text.startsWith("{") || text.startsWith("[")) {
        try {
          const parsed = JSON.parse(text);
          return Array.isArray(parsed) ? { items: parsed } : parsed;
        } catch {
          return null;
        }
      }

      if (contentType.includes("application/x-www-form-urlencoded")) {
        return parseBodyValue(new URLSearchParams(text), contentType);
      }

      return null;
    }

    if (typeof FormData !== "undefined" && body instanceof FormData) {
      const data = {};
      for (const [key, value] of body.entries()) {
        if (typeof value === "string") data[key] = value;
      }
      return Object.keys(data).length ? data : null;
    }

    if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
      return Object.fromEntries(body.entries());
    }

    if (typeof body === "object") return body;
    return null;
  }

  async function parseCartRequest(input, init) {
    const explicitBody = init?.body;
    if (explicitBody != null) {
      const contentType = new Headers(init?.headers || {}).get("content-type") || "";
      return parseBodyValue(explicitBody, contentType.toLowerCase());
    }

    if (typeof Request !== "undefined" && input instanceof Request) {
      const request = input.clone();
      const contentType = request.headers.get("content-type") || "";
      if (contentType.includes("multipart/form-data")) {
        try {
          return parseBodyValue(await request.formData(), contentType.toLowerCase());
        } catch {
          return null;
        }
      }
      try {
        return parseBodyValue(await request.text(), contentType.toLowerCase());
      } catch {
        return null;
      }
    }

    return null;
  }

  function requestUrl(input) {
    return String(typeof input === "string" ? input : input?.url || "");
  }

  function requestMethod(input, init) {
    if (init?.method) return String(init.method).toUpperCase();
    if (typeof Request !== "undefined" && input instanceof Request) {
      return String(input.method || "GET").toUpperCase();
    }
    return "GET";
  }

  function isCartAddRequest(input, init) {
    if (requestMethod(input, init) === "GET") return false;
    return /\/cart\/add(?:\.js)?(?:\?|$)/.test(requestUrl(input));
  }

  function isCartMutateRequest(input, init) {
    if (requestMethod(input, init) === "GET") return false;
    return /\/cart\/(?:change|update|clear)(?:\.js)?(?:\?|$)/.test(requestUrl(input));
  }

  function mergeRequestHeaders(input, init) {
    const headers = new Headers();
    if (typeof Request !== "undefined" && input instanceof Request) {
      input.headers.forEach((value, key) => headers.set(key, value));
    }
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }
    headers.set("Content-Type", "application/json");
    headers.set("Accept", "application/json");
    headers.delete("Content-Length");
    return headers;
  }

  function buildFetchInit(input, init, body) {
    const nextInit = { ...(init || {}) };
    if (typeof Request !== "undefined" && input instanceof Request) {
      nextInit.credentials = nextInit.credentials || input.credentials;
      nextInit.mode = nextInit.mode || input.mode;
    }
    nextInit.method = "POST";
    nextInit.headers = mergeRequestHeaders(input, init);
    nextInit.body = JSON.stringify(body);
    return nextInit;
  }

  async function interceptCartAdd(input, init) {
    const requestBody = await parseCartRequest(input, init);
    if (!requestBody) {
      ewDebug("[EW PDP] Cart add body could not be parsed; request left unchanged");
      return null;
    }

    const requestItems = getRequestItems(requestBody);
    if (requestItems.some(isWarrantyLine)) return null;
    if (![...widgets.values()].some(selectedPlan)) return null;

    ewDebug("[EW PDP] Original cart add payload", requestBody);
    const nestedBody = await buildNestedCartBody(requestBody);
    if (!nestedBody) return null;
    return nestedBody;
  }

  function getParentKey(item) {
    const rel = item?.parent_relationship;
    if (!rel) return null;
    return rel.parent_key || rel.parent?.key || rel.parent_line_key || null;
  }

  function warrantyUnitPrice(item) {
    const qty = Number(item?.quantity) || 1;
    const candidates = [
      item?.final_price,
      item?.price,
      qty ? Number(item?.final_line_price) / qty : null,
      qty ? Number(item?.line_price) / qty : null,
      item?.original_price,
    ];
    for (const value of candidates) {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric >= 0) return numeric;
    }
    return 0;
  }

  function sortByLowestWarrantyPrice(items) {
    return [...items].sort((a, b) => {
      const diff = warrantyUnitPrice(a) - warrantyUnitPrice(b);
      if (diff !== 0) return diff;
      return String(a.key).localeCompare(String(b.key));
    });
  }

  function warrantyChildrenOf(cart, parentKey) {
    return (cart?.items || []).filter(
      (item) => isWarrantyLine(item) && getParentKey(item) === parentKey
    );
  }

  async function setLineQuantity(key, quantity) {
    if (!nativeFetch || !key) return null;
    const previous = ewInternal;
    ewInternal = true;
    try {
      const response = await nativeFetch(cartEndpoint("change.js"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ id: key, quantity }),
      });
      if (!response.ok) {
        console.warn("[EW PDP] Failed to update cart line", key, quantity);
        return null;
      }
      return response.json();
    } catch (err) {
      console.warn("[EW PDP] Failed to update cart line", key, err);
      return null;
    } finally {
      ewInternal = previous;
    }
  }

  async function readCart() {
    if (!nativeFetch) return null;
    const previous = ewInternal;
    ewInternal = true;
    try {
      const response = await nativeFetch(cartEndpoint("cart.js"), {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return null;
      return response.json();
    } catch {
      return null;
    } finally {
      ewInternal = previous;
    }
  }

  async function syncChildrenToQuantity(children, targetQty) {
    const total = children.reduce((sum, child) => sum + Number(child.quantity || 0), 0);
    if (total === targetQty) return null;

    let lastCart = null;
    if (targetQty <= 0) {
      for (const child of children) {
        lastCart = (await setLineQuantity(child.key, 0)) || lastCart;
      }
      return lastCart;
    }

    if (total > targetQty) {
      let excess = total - targetQty;
      for (const child of sortByLowestWarrantyPrice(children)) {
        if (excess <= 0) break;
        const current = Number(child.quantity || 0);
        const remove = Math.min(current, excess);
        lastCart = (await setLineQuantity(child.key, current - remove)) || lastCart;
        excess -= remove;
      }
      return lastCart;
    }

    const highest = [...children].sort((a, b) => warrantyUnitPrice(b) - warrantyUnitPrice(a))[0];
    if (!highest) return null;
    return setLineQuantity(highest.key, Number(highest.quantity || 0) + (targetQty - total));
  }

  async function reconcileCart(cart) {
    if (!cart?.items || reconciling) return cart;
    reconciling = true;
    let current = cart;
    try {
      for (let i = 0; i < 20; i += 1) {
        const items = current.items || [];
        const keys = new Set(items.map((item) => item.key));
        const orphan = items.find((item) => {
          if (!isWarrantyLine(item)) return false;
          const parentKey = getParentKey(item);
          return !parentKey || !keys.has(parentKey);
        });
        if (!orphan) break;
        current = (await setLineQuantity(orphan.key, 0)) || current;
      }

      const parents = (current.items || []).filter((item) => !isWarrantyLine(item));
      for (const parent of parents) {
        const children = warrantyChildrenOf(current, parent.key);
        if (!children.length) continue;
        const next = await syncChildrenToQuantity(children, Number(parent.quantity || 0));
        if (next) current = next;
      }
      return current;
    } finally {
      reconciling = false;
    }
  }

  function findCartLine(cart, idOrKey, lineIndex) {
    const items = cart?.items || [];
    if (lineIndex != null && lineIndex !== "") {
      const index = Number(lineIndex) - 1;
      if (index >= 0 && items[index]) return items[index];
    }
    if (idOrKey == null || idOrKey === "") return null;
    const id = String(idOrKey);
    return (
      items.find((item) => item.key === id) ||
      items.find((item) => String(item.id) === id || String(item.variant_id) === id)
    );
  }

  function mutationChanges(body, cart) {
    if (!body || !cart) return [];
    if (body.updates && typeof body.updates === "object") {
      return Object.entries(body.updates)
        .map(([id, qty]) => {
          const item = findCartLine(cart, id);
          return item
            ? { item, newQty: normalizeQuantity(qty, 0, { allowZero: true }) }
            : null;
        })
        .filter(Boolean);
    }

    const updates = {};
    for (const [key, value] of Object.entries(body)) {
      const match = /^updates\[([^\]]+)\]$/.exec(key);
      if (match) updates[match[1]] = value;
    }
    if (Object.keys(updates).length) {
      return mutationChanges({ updates }, cart);
    }

    if (body.id != null || body.line != null) {
      const item = findCartLine(cart, body.id, body.line);
      if (!item) return [];
      return [{ item, newQty: normalizeQuantity(body.quantity, 0, { allowZero: true }) }];
    }

    return [];
  }

  async function beforeCartMutation(body) {
    const cart = await readCart();
    if (!cart) return;
    const changes = mutationChanges(body, cart);
    for (const change of changes) {
      if (isWarrantyLine(change.item)) continue;
      if (change.newQty >= Number(change.item.quantity || 0)) continue;
      const children = warrantyChildrenOf(cart, change.item.key);
      if (!children.length) continue;
      await syncChildrenToQuantity(children, change.newQty);
    }
  }

  async function refreshCartSections(cart, body) {
    if (!body?.sections || !nativeFetch) return cart;
    const previous = ewInternal;
    ewInternal = true;
    try {
      const payload = { updates: {}, sections: body.sections };
      if (body.sections_url) payload.sections_url = body.sections_url;
      const response = await nativeFetch(cartEndpoint("update.js"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (response.ok) return response.json();
    } catch (err) {
      console.warn("[EW PDP] Failed to refresh cart sections", err);
    } finally {
      ewInternal = previous;
    }
    return cart;
  }

  function jsonResponse(data, sourceResponse) {
    return new Response(JSON.stringify(data), {
      status: sourceResponse.status,
      statusText: sourceResponse.statusText,
      headers: { "Content-Type": "application/json" },
    });
  }

  function notifyCartChanged() {
    document.dispatchEvent(new CustomEvent("cart:updated"));
    document.dispatchEvent(new CustomEvent("cart:refresh"));
  }

  async function handleMutateResponse(response, requestBody) {
    if (!response.ok) return response;
    let cart;
    try {
      cart = await response.clone().json();
    } catch {
      return response;
    }
    if (!cart?.items) return response;
    const reconciled = await reconcileCart(cart);
    const withSections = await refreshCartSections(reconciled, requestBody);
    return jsonResponse(withSections, response);
  }

  function installCartHook() {
    if (cartHookInstalled || !nativeFetch) return;
    cartHookInstalled = true;

    window.fetch = async function ewPdpFetch(input, init) {
      if (ewInternal) return nativeFetch(input, init);

      if (isCartAddRequest(input, init)) {
        try {
          const nestedBody = await interceptCartAdd(input, init);
          if (nestedBody) {
            ewLog("[EW PDP] Sending product + warranty as nested cart lines");
            const url = requestUrl(input);
            const rewrittenInit = buildFetchInit(input, init, nestedBody);
            const nestedResponse = await nativeFetch(url, rewrittenInit);
            if (nestedResponse.ok) return nestedResponse;
            console.warn(
              "[EW PDP] Nested cart add failed; adding product without warranty",
              await nestedResponse.clone().text().catch(() => "")
            );
          }
        } catch (error) {
          console.warn(
            "[EW PDP] Warranty cart preparation failed; adding product normally.",
            error
          );
        }
        return nativeFetch(input, init);
      }

      if (isCartMutateRequest(input, init)) {
        const requestBody = await parseCartRequest(input, init);
        try {
          await beforeCartMutation(requestBody);
        } catch (err) {
          console.warn("[EW PDP] Pre-change warranty sync failed", err);
        }
        const response = await nativeFetch(input, init);
        try {
          return await handleMutateResponse(response, requestBody);
        } catch (err) {
          console.warn("[EW PDP] Post-change warranty sync failed", err);
          return response;
        }
      }

      return nativeFetch(input, init);
    };

    if (typeof XMLHttpRequest === "undefined") return;

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function ewOpen(method, url, ...rest) {
      this.__ewMethod = method;
      this.__ewUrl = url;
      return originalOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function ewSend(body) {
      if (this.__ewInternal || ewInternal) {
        return originalSend.call(this, body);
      }

      const fakeInput = { url: String(this.__ewUrl || ""), method: this.__ewMethod || "POST" };
      const xhr = this;

      const finishWithBody = (nextBody, asJson) => {
        if (asJson) {
          try {
            xhr.setRequestHeader("Content-Type", "application/json");
            xhr.setRequestHeader("Accept", "application/json");
          } catch {
            // Headers may already be set by the theme.
          }
          originalSend.call(xhr, JSON.stringify(nextBody));
          return;
        }
        originalSend.call(xhr, nextBody);
      };

      if (isCartAddRequest(fakeInput, { method: fakeInput.method, body })) {
        interceptCartAdd(fakeInput, { method: fakeInput.method, body })
          .then((nestedBody) => {
            if (nestedBody) {
              ewLog("[EW PDP] Sending product + warranty as nested cart lines");
              finishWithBody(nestedBody, true);
              return;
            }
            originalSend.call(xhr, body);
          })
          .catch((error) => {
            console.warn(
              "[EW PDP] Warranty cart preparation failed; adding product normally.",
              error
            );
            originalSend.call(xhr, body);
          });
        return;
      }

      if (isCartMutateRequest(fakeInput, { method: fakeInput.method, body })) {
        xhr.addEventListener("load", () => {
          if (ewInternal || reconciling) return;
          readCart()
            .then((cart) => (cart ? reconcileCart(cart) : null))
            .then((cart) => {
              if (cart) notifyCartChanged();
            })
            .catch((err) => console.warn("[EW PDP] XHR warranty sync failed", err));
        });
        parseBodyValue(body, "")
          .then((requestBody) => beforeCartMutation(requestBody))
          .catch((err) => console.warn("[EW PDP] Pre-change warranty sync failed", err))
          .finally(() => originalSend.call(xhr, body));
        return;
      }

      return originalSend.call(this, body);
    };
  }

  function onRootClick(state, event) {
    const planButton = event.target.closest("[data-ew-plan-id]");
    if (planButton) {
      state.selectedPlanId = planButton.getAttribute("data-ew-plan-id");
      renderWidget(state);
      return;
    }
    if (event.target.closest("[data-ew-open-modal]")) {
      openModal(state);
    }
  }

  function onModalClick(state, event) {
    if (event.target.closest("[data-ew-close-modal]")) {
      closeModal(state);
      return;
    }
    const planButton = event.target.closest("[data-ew-modal-plan]");
    if (planButton) {
      state.modalPlanId = planButton.getAttribute("data-ew-modal-plan");
      renderModal(state);
      return;
    }
    if (event.target.closest("[data-ew-save]")) {
      const nextId = state.modalPlanId;
      state.selectedPlanId = nextId === NONE_PLAN_ID ? null : nextId;
      renderWidget(state);
      closeModal(state);
    }
  }

  function notifyVariantChange(variantId) {
    const nextId = Number(variantId);
    if (!nextId) return;
    widgets.forEach((state) => {
      if (nextId === Number(state.variantId)) return;
      loadForVariant(state, nextId);
    });
  }

  function installVariantWatch() {
    if (variantWatchInstalled) return;
    variantWatchInstalled = true;

    document.addEventListener("variant:update", (event) => {
      const id =
        event.detail?.variant?.id || event.detail?.data?.variant?.id || event.detail?.id;
      if (id) notifyVariantChange(id);
    });

    document.addEventListener("change", (event) => {
      const target = event.target;
      if (!target) return;
      if (target.name === "id" && target.closest?.('form[action*="/cart/add"]')) {
        notifyVariantChange(target.value);
      }
    });

    const urlCheck = () => {
      const urlId = variantFromUrl();
      if (urlId) notifyVariantChange(urlId);
    };
    window.addEventListener("popstate", urlCheck);

    if (!history.pushState.__ewPdpWrapped) {
      const originalPush = history.pushState;
      const originalReplace = history.replaceState;
      history.pushState = function (...args) {
        const result = originalPush.apply(this, args);
        urlCheck();
        return result;
      };
      history.replaceState = function (...args) {
        const result = originalReplace.apply(this, args);
        urlCheck();
        return result;
      };
      history.pushState.__ewPdpWrapped = true;
    }
  }

  function initWidget(root) {
    if (root.dataset.ewReady === "true") return;
    root.dataset.ewReady = "true";

    const state = {
      root,
      productId: Number(root.dataset.productId),
      productTitle: root.dataset.productTitle || "",
      variantId: Number(root.dataset.variantId),
      sku: root.dataset.variantSku || "",
      variantTitle: root.dataset.variantTitle || "",
      productImage: root.dataset.productImage || "",
      country: root.dataset.country || "",
      currency: root.dataset.currency || "",
      providerName: root.dataset.providerName || "",
      providerLogo: root.dataset.providerLogo || "",
      shopName: root.dataset.shopName || "",
      variants: parseVariants(root),
      offer: null,
      selectedPlanId: null,
      modalPlanId: null,
      modal: null,
      requestGeneration: 0,
      hasRenderedPlans: false,
    };

    widgets.set(root.dataset.blockId, state);
    root.addEventListener("click", (event) => onRootClick(state, event));
    document.addEventListener("click", (event) => {
      if (state.modal && event.target.closest(".ew-pdp-modal") === state.modal) {
        onModalClick(state, event);
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeModal(state);
    });

    installVariantWatch();
    installCartHook();
    loadForVariant(state, resolveCurrentVariantId(state));
  }

  function initAll() {
    installCartHook();
    document.querySelectorAll("[data-ew-pdp-root]").forEach(initWidget);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAll);
  } else {
    initAll();
  }

  document.addEventListener("shopify:section:load", initAll);
  document.addEventListener("shopify:section:reorder", initAll);
})();
