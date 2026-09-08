(() => {
  if (window.__SENNH_EW_PDP_NESTED__) return;
  window.__SENNH_EW_PDP_NESTED__ = true;

  const PROXY_OFFER = "/apps/warranty/extended-warranty/pdp-offer";
  const PROXY_CART = "/apps/warranty/extended-warranty/pdp-cart-payload";
  const NONE_PLAN_ID = "none";
  const WARRANTY_CART_ERROR =
    "We couldn't add the selected extended warranty to your cart. Please try again or select another warranty option.";

  const widgets = new Map();
  const offerCache = new Map();
  let cartHookInstalled = false;
  let variantWatchInstalled = false;
  let cartUiInstalled = false;
  let nativeFetch = typeof window.fetch === "function" ? window.fetch.bind(window) : null;
  let ewInternal = false;
  let reconciling = false;
  let cartUiTimer = null;
  let cartUiRendering = false;

  const sharedModal = {
    el: null,
    context: null,
    offer: null,
    modalPlanId: null,
    requestGeneration: 0,
    saving: false,
  };

  function escapeHtml(str) {
    if (str == null || str === "") return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function quoteAttr(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function shopifyRoot() {
    const root = window.Shopify?.routes?.root || "/";
    return root.endsWith("/") ? root : `${root}/`;
  }

  /**
   * Shopify Ajax Cart API:
   * GET  /cart.js
   * POST /cart/add.js, /cart/change.js, /cart/update.js, /cart/clear.js
   */
  function cartEndpoint(name) {
    const root = shopifyRoot();
    const file = String(name || "").replace(/^\/+/, "");
    const path = file === "cart.js" || file === "js" ? "cart.js" : `cart/${file.replace(/^cart\//, "")}`;
    return `${root}${path}`.replace(/([^:]\/)\/+/g, "$1");
  }

  function isTwoYearPlan(plan) {
    return (
      Number(plan?.durationMonths) === 24 ||
      Number(plan?.durationYears) === 2 ||
      /\+?\s*2\s*(yr|year)/i.test(plan?.planName || "")
    );
  }

  function defaultPlanId(plans) {
    if (!plans?.length) return null;
    const twoYear = plans.find(isTwoYearPlan);
    return twoYear?.planId ?? plans[0]?.planId ?? null;
  }

  function resolveDraftPlanId(plans, existingId) {
    if (existingId && existingId !== NONE_PLAN_ID) {
      const match = (plans || []).find((plan) => String(plan.planId) === String(existingId));
      if (match) return match.planId;
    }
    return defaultPlanId(plans) || NONE_PLAN_ID;
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

  function createGroupId() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    return `ew_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
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
    return root?.dataset?.[key] || fallback;
  }

  function defaultLabels(root) {
    return {
      noneLabel: labelFor(root, "noneLabel", "No Extended Coverage"),
      saveLabel: labelFor(root, "saveLabel", "SAVE"),
      termsLabel: labelFor(root, "termsLabel", "Detailed Terms And Conditions"),
      footerNote: labelFor(
        root,
        "footerNote",
        "Let us handle the worries, and you enjoy your purchase!"
      ),
      trustLabel: labelFor(root, "trustLabel", "Trusted by 100K+ customers"),
      loadingLabel: labelFor(root, "loadingLabel", "Loading warranty options..."),
      emptyLabel: labelFor(root, "emptyLabel", "Extended warranty is not available"),
      errorLabel: labelFor(root, "errorLabel", "Warranty options could not be loaded"),
      shopLogo: root?.dataset?.shopLogo || "",
      shopName: root?.dataset?.shopName || "SENNHEISER",
    };
  }

  function offerUnavailableMessage(offer, labels) {
    if (!offer) return labels.errorLabel;
    if (offer.reason === "pricing_unavailable") {
      return offer.message || "Warranty price could not be calculated for this product variant.";
    }
    if (offer.reason === "pricing_type_unconfigured") {
      return offer.message || "Warranty pricing is not configured.";
    }
    return labels.emptyLabel;
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
      ${
        state.cartError
          ? `<p class="ew-pdp__status is-error" data-ew-cart-error>${escapeHtml(state.cartError)}</p>`
          : ""
      }
    `;
  }

  function closestFromEvent(event, selector) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    for (const node of path) {
      if (!(node instanceof Element)) continue;
      if (node.matches(selector)) return node;
      const nested = node.closest(selector);
      if (nested) return nested;
    }
    const target = event.target;
    return target instanceof Element ? target.closest(selector) : null;
  }

  function ensureSharedModal() {
    if (sharedModal.el) return sharedModal.el;
    const modal = document.createElement("dialog");
    modal.className = "ew-pdp-modal";
    modal.setAttribute("aria-modal", "true");
    modal.innerHTML = `
      <div class="ew-pdp-modal__backdrop" data-ew-close-modal></div>
      <div class="ew-pdp-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="ew-pdp-modal-title">
        <button type="button" class="ew-pdp-modal__close" data-ew-close-modal aria-label="Close">×</button>
        <div class="ew-pdp-modal__left"></div>
        <div class="ew-pdp-modal__right"></div>
        <div class="ew-pdp-modal__footer"></div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener("click", onSharedModalClick);
    modal.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeSharedModal();
    });
    sharedModal.el = modal;
    return modal;
  }

  function modalLabels() {
    return defaultLabels(sharedModal.context?.widget?.root || document.querySelector("[data-ew-pdp-root]"));
  }

  function renderSharedModal() {
    const modal = ensureSharedModal();
    const context = sharedModal.context;
    if (!context) return;

    const labels = modalLabels();
    const offer = sharedModal.offer;
    const plans = offer?.plans || [];
    const coverage = parseCoverageLines(offer?.settings?.coverageText);
    const draftId = sharedModal.modalPlanId ?? NONE_PLAN_ID;
    const currency = offer?.currency;
    const termsUrl = offer?.settings?.termsUrl;
    const productTitle = context.productTitle || "";
    const productImage = context.productImage || "";

    const coverageHtml = coverage.length
      ? `<ul class="ew-pdp-modal__coverage">${coverage
          .map((line) => `<li>${escapeHtml(line)}</li>`)
          .join("")}</ul>`
      : `<p class="ew-pdp__status">Coverage details are listed in the terms and conditions.</p>`;

    modal.querySelector(".ew-pdp-modal__left").innerHTML = `
      <h2 class="ew-pdp-modal__kicker" id="ew-pdp-modal-title">What's Included?</h2>
      ${coverageHtml}
      <div class="ew-pdp-modal__trust">
        <div class="ew-pdp-modal__stars" aria-hidden="true">★★★★★</div>
        <p class="ew-pdp-modal__trust-text">${escapeHtml(labels.trustLabel)}</p>
        <div class="ew-pdp-modal__brands">
          ${
            labels.shopLogo
              ? `<img src="${escapeHtml(labels.shopLogo)}" alt="${escapeHtml(labels.shopName)}">`
              : `<span>${escapeHtml(labels.shopName)}</span>`
          }
        </div>
      </div>
    `;

    let rightHtml;
    if (!offer) {
      rightHtml = `<p class="ew-pdp__status">${escapeHtml(labels.loadingLabel)}</p>`;
    } else if (offer.error) {
      rightHtml = `<p class="ew-pdp__status is-error">${escapeHtml(labels.errorLabel)}</p>`;
    } else if (!offer.eligible || !plans.length) {
      rightHtml = `<p class="ew-pdp__status">${escapeHtml(offerUnavailableMessage(offer, labels))}</p>`;
    } else {
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
          <span class="ew-pdp-modal__plan-name">${escapeHtml(labels.noneLabel)}</span>
          <span class="ew-pdp-modal__plan-price"></span>
        </button>`,
      ].join("");

      rightHtml = `
        <div class="ew-pdp-modal__product">
          <h3 class="ew-pdp-modal__product-title">${escapeHtml(productTitle)}</h3>
          ${productImage ? `<img src="${escapeHtml(productImage)}" alt="${escapeHtml(productTitle)}">` : ""}
        </div>
        <p class="ew-pdp-modal__select-label">Select a coverage plan</p>
        <div class="ew-pdp-modal__plan-list">${planButtons}</div>
        <button type="button" class="ew-pdp-modal__save" data-ew-save${sharedModal.saving ? " disabled" : ""}>${escapeHtml(labels.saveLabel)}</button>
      `;
    }

    modal.querySelector(".ew-pdp-modal__right").innerHTML = rightHtml;
    modal.querySelector(".ew-pdp-modal__footer").innerHTML = `
      <p>${escapeHtml(labels.footerNote)}</p>
      ${
        termsUrl
          ? `<a class="ew-pdp-modal__terms" href="${escapeHtml(termsUrl)}" target="_blank" rel="noopener">${escapeHtml(labels.termsLabel)}</a>`
          : `<span></span>`
      }
    `;
  }

  function closeSharedModal() {
    const modal = sharedModal.el;
    if (!modal) return;
    if (typeof modal.close === "function" && modal.open) {
      modal.close();
    }
    modal.hidden = true;
    document.body.classList.remove("ew-pdp-modal-open");
    sharedModal.saving = false;
  }

  function resetSharedModal(context) {
    sharedModal.context = context;
    sharedModal.offer = context.offer || null;
    sharedModal.modalPlanId = resolveDraftPlanId(context.offer?.plans, context.selectedPlanId);
    sharedModal.saving = false;
    sharedModal.requestGeneration += 1;
  }

  async function openSharedModal(context) {
    resetSharedModal(context);
    const modal = ensureSharedModal();
    renderSharedModal();
    modal.hidden = false;
    try {
      if (typeof modal.showModal === "function" && !modal.open) modal.showModal();
    } catch {
      modal.setAttribute("open", "");
    }
    document.body.classList.add("ew-pdp-modal-open");

    if (sharedModal.offer) return;

    try {
      const offer = await requestOffer(context, sharedModal);
      if (!offer || sharedModal.context !== context) return;
      sharedModal.offer = offer;
      if (context.kind === "pdp" && context.widget) {
        context.widget.offer = offer;
      }
      sharedModal.modalPlanId = resolveDraftPlanId(offer?.plans, context.selectedPlanId);
      renderSharedModal();
    } catch {
      if (sharedModal.context !== context) return;
      sharedModal.offer = { eligible: false, error: true };
      renderSharedModal();
    }
  }

  function openPdpModal(state) {
    if (!state.offer?.eligible) return;
    openSharedModal({
      kind: "pdp",
      widget: state,
      productId: state.productId,
      variantId: state.variantId,
      productTitle: state.productTitle,
      productImage: state.productImage,
      sku: state.sku,
      country: state.country,
      offer: state.offer,
      selectedPlanId: state.selectedPlanId,
    });
  }

  async function requestOffer({ productId, variantId, sku, country }, generationHolder) {
    const generation = ++generationHolder.requestGeneration;
    const params = new URLSearchParams({
      product_id: String(productId),
      variant_id: String(variantId || ""),
    });
    if (sku) params.set("sku", sku);
    if (country) params.set("country", country);

    const response = await fetch(`${PROXY_OFFER}?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
    const data = await response.json().catch(() => ({}));
    if (generation !== generationHolder.requestGeneration) return null;
    if (!response.ok) {
      throw new Error(data.error || "Failed to load warranty plans");
    }
    return data;
  }

  function cacheKey(productId, variantId) {
    return `${productId}:${variantId || ""}`;
  }

  function loadCachedOffer({ productId, variantId, sku, country }) {
    const key = cacheKey(productId, variantId);
    if (offerCache.has(key)) return offerCache.get(key);
    const holder = { requestGeneration: 0 };
    const pending = requestOffer({ productId, variantId, sku, country }, holder).catch(() => null);
    offerCache.set(key, pending);
    return pending;
  }

  async function loadForVariant(state, variantId, { keepSelection } = {}) {
    applyVariantMeta(state, variantId);
    renderStatus(state, labelFor(state.root, "loadingLabel", "Loading warranty options..."), false);

    try {
      const offer = await requestOffer(state, state);
      if (!offer) return;

      state.offer = offer;
      offerCache.set(cacheKey(state.productId, state.variantId), Promise.resolve(offer));

      if (!offer.eligible || !offer.plans?.length) {
        state.selectedPlanId = null;
        if (state.hasRenderedPlans) {
          renderStatus(state, offerUnavailableMessage(offer, defaultLabels(state.root)), false);
        } else {
          state.root.hidden = true;
          state.root.innerHTML = "";
        }
        return;
      }

      if (
        keepSelection &&
        state.selectedPlanId &&
        state.selectedPlanId !== NONE_PLAN_ID &&
        offer.plans.some((plan) => String(plan.planId) === String(state.selectedPlanId))
      ) {
        // Keep the customer's explicit choice when the same plan still exists.
      } else {
        state.selectedPlanId = defaultPlanId(offer.plans);
      }

      state.hasRenderedPlans = true;
      renderWidget(state);
      if (
        sharedModal.el &&
        !sharedModal.el.hidden &&
        sharedModal.context?.kind === "pdp" &&
        sharedModal.context?.widget === state
      ) {
        sharedModal.offer = offer;
        sharedModal.context = {
          ...sharedModal.context,
          variantId: state.variantId,
          productImage: state.productImage,
          sku: state.sku,
          offer,
          selectedPlanId: state.selectedPlanId,
        };
        sharedModal.modalPlanId = resolveDraftPlanId(offer.plans, state.selectedPlanId);
        renderSharedModal();
      }
    } catch (err) {
      ewDebug("[EW PDP] offer failed; product purchase remains available", err);
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

  function isWarrantyCatalogItem(item) {
    if (isWarrantyLine(item)) return true;
    const handle = String(item?.handle || "").toLowerCase();
    if (handle === "sennheiser-extended-warranty") return true;
    const sku = String(item?.sku || "");
    if (/^EW-\d+/i.test(sku)) return true;
    return false;
  }

  function collectProperties(item) {
    return propertyMap(item);
  }

  function getParentKey(item) {
    const rel = item?.parent_relationship;
    if (rel) {
      const nested = rel.parent_key || rel.parent?.key || rel.parent_line_key || null;
      if (nested) return nested;
    }
    return propertyMap(item)._ew_parent_key || null;
  }

  function warrantyChildrenOf(cart, parent) {
    const parentKey = parent?.key;
    const parentGroup = propertyMap(parent)._ew_group_id;
    return (cart?.items || []).filter((item) => {
      if (!isWarrantyLine(item)) return false;
      const props = propertyMap(item);
      if (parentKey && (getParentKey(item) === parentKey || props._ew_parent_key === parentKey)) {
        return true;
      }
      return Boolean(parentGroup && props._ew_group_id && props._ew_group_id === parentGroup);
    });
  }

  function findWarrantyParent(cart, warranty) {
    const parents = (cart?.items || []).filter((item) => !isWarrantyLine(item));
    const props = propertyMap(warranty);
    const parentKey = getParentKey(warranty) || props._ew_parent_key;
    if (parentKey) {
      const byKey = parents.find((item) => item.key === parentKey);
      if (byKey) return byKey;
    }
    if (props._ew_group_id) {
      const byGroup = parents.find(
        (item) => propertyMap(item)._ew_group_id === props._ew_group_id
      );
      if (byGroup) return byGroup;
    }
    return null;
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

  async function fetchWarrantyPayload(context, plan) {
    const response = await fetch(PROXY_CART, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        product_id: context.productId,
        variant_id: context.variantId,
        plan_id: plan.planId,
        sku: context.sku || "",
        country: context.country || "",
        group_id: context.groupId || "",
        parent_key: context.parentLineKey || "",
        source: context.source || "pdp",
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

  function warrantyLinePayload(payload, plan, context, quantity, parentVariantId, groupId) {
    const warrantyVariantId = normalizeVariantId(payload.variantId);
    const line = {
      id: warrantyVariantId,
      quantity,
      properties: {
        ...(payload.properties || {}),
        _ew_type: "extended_warranty",
        _ew_source: context.source || "pdp",
        _ew_plan_id: String(plan.planId),
        _ew_plan_name: String(plan.planName || payload.planName || ""),
        _ew_product_id: String(context.productId),
        _ew_variant_id: String(parentVariantId),
        _ew_group_id: groupId,
        ...(context.parentLineKey ? { _ew_parent_key: String(context.parentLineKey) } : {}),
      },
    };
    // Existing cart lines must be referenced by line key. parent_id is a variant id
    // and Shopify rejects it with 422 once the parent is already in the cart.
    if (context.parentLineKey) {
      line.parent_line_key = String(context.parentLineKey);
    } else if (parentVariantId) {
      line.parent_id = parentVariantId;
    }
    return line;
  }

  async function buildNestedCartBody(body) {
    const sourceItems = getRequestItems(body);
    if (!sourceItems.length) return null;

    const nextItems = sourceItems.map((item) => toCartLine(item)).filter(Boolean);
    if (!nextItems.length) return null;

    const cart = await readCart();
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

      const parentVariantId = normalizeVariantId(parent.id ?? state.variantId);
      const existingParent = (cart?.items || []).find((item) => {
        if (isWarrantyLine(item)) return false;
        if (normalizeVariantId(item.variant_id || item.id) !== parentVariantId) return false;
        if (state.productId && Number(item.product_id) !== Number(state.productId)) return false;
        return true;
      });
      if (existingParent && warrantyChildrenOf(cart, existingParent).length) {
        ewDebug("[EW PDP] Parent already has a warranty; skipping nested add");
        continue;
      }

      const groupId = createGroupId();
      const payload = await fetchWarrantyPayload(
        {
          productId: state.productId,
          variantId: parentVariantId,
          sku: state.sku,
          country: state.country,
          groupId,
          source: "pdp",
        },
        plan
      );
      const warrantyVariantId = normalizeVariantId(payload.variantId);
      const productQuantity = normalizeQuantity(parent.quantity, quantityFromContext());

      if (!parentVariantId) {
        throw new Error("Could not determine parent variant ID");
      }
      if (!warrantyVariantId) {
        throw new Error("Checkout variant not configured for this plan");
      }
      if (warrantyVariantId === parentVariantId) {
        throw new Error("Checkout variant not configured for this plan");
      }

      parent.quantity = productQuantity;
      parent.properties = {
        ...(parent.properties || {}),
        _ew_plan_id: String(plan.planId),
        _ew_group_id: groupId,
      };

      nextItems.push(
        warrantyLinePayload(
          payload,
          plan,
          {
            productId: state.productId,
            source: "pdp",
          },
          productQuantity,
          parentVariantId,
          groupId
        )
      );

      warrantyAdded = true;
    }

    if (!warrantyAdded) return null;

    return {
      ...extraCartFields(body),
      items: nextItems,
    };
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
    if (!requestBody) return null;

    const requestItems = getRequestItems(requestBody);
    if (requestItems.some(isWarrantyLine)) return null;
    if (![...widgets.values()].some(selectedPlan)) return null;

    const nestedBody = await buildNestedCartBody(requestBody);
    if (!nestedBody) return null;
    return nestedBody;
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
      if (!response.ok) return null;
      return response.json();
    } catch {
      return null;
    } finally {
      ewInternal = previous;
    }
  }

  async function replaceLineProperties(item, properties) {
    if (!nativeFetch || !item?.key) return null;
    const previous = ewInternal;
    ewInternal = true;
    try {
      const response = await nativeFetch(cartEndpoint("change.js"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          id: item.key,
          quantity: item.quantity,
          properties,
        }),
      });
      if (!response.ok) return null;
      return response.json();
    } catch {
      return null;
    } finally {
      ewInternal = previous;
    }
  }

  async function updateLineProperties(item, extra) {
    return replaceLineProperties(item, { ...propertyMap(item), ...extra });
  }

  async function readCart() {
    if (!nativeFetch) return null;
    const previous = ewInternal;
    ewInternal = true;
    try {
      const response = await nativeFetch(cartEndpoint("cart.js"), {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        ewDebug("[EW] Failed to load /cart.js", response.status);
        return null;
      }
      const cart = await response.json();
      if (!cart || !Array.isArray(cart.items)) return null;
      return cart;
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
        const orphan = items.find((item) => {
          if (!isWarrantyLine(item)) return false;
          return !findWarrantyParent(current, item);
        });
        if (!orphan) break;
        current = (await setLineQuantity(orphan.key, 0)) || current;
      }

      const parents = (current.items || []).filter((item) => !isWarrantyLine(item));
      for (const parent of parents) {
        const children = warrantyChildrenOf(current, parent);
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
      const children = warrantyChildrenOf(cart, change.item);
      if (!children.length) continue;
      await syncChildrenToQuantity(children, change.newQty);
    }
  }

  function cartSectionIds() {
    const ids = new Set();
    document.querySelectorAll("cart-items-component[data-section-id], cart-drawer-component[data-section-id], cart-drawer[data-section-id]").forEach((el) => {
      if (el.dataset.sectionId) ids.add(el.dataset.sectionId);
    });
    document.querySelectorAll("[id^='shopify-section-']").forEach((el) => {
      const id = el.id.replace(/^shopify-section-/, "");
      if (/cart/i.test(id)) ids.add(id);
    });
    return [...ids];
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
    } catch {
      // Theme sections refresh is best-effort.
    } finally {
      ewInternal = previous;
    }
    return cart;
  }

  async function cartWithSections(cart) {
    const sections = cartSectionIds();
    if (!sections.length || !cart) return cart;
    const withAjax = await refreshCartSections(cart, {
      sections,
      sections_url: window.location.pathname,
    });
    if (withAjax?.sections && Object.keys(withAjax.sections).length) return withAjax;

    if (!nativeFetch) return withAjax || cart;
    const previous = ewInternal;
    ewInternal = true;
    try {
      const params = new URLSearchParams({ sections: sections.join(",") });
      const response = await nativeFetch(`${window.location.pathname}?${params.toString()}`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return withAjax || cart;
      const html = await response.json();
      return { ...cart, sections: html };
    } catch {
      return withAjax || cart;
    } finally {
      ewInternal = previous;
    }
  }

  function warrantySelectionActive() {
    return [...widgets.values()].some((state) => Boolean(selectedPlan(state)));
  }

  function showWarrantyCartError(message) {
    const text = message || WARRANTY_CART_ERROR;
    widgets.forEach((state) => {
      if (!selectedPlan(state)) return;
      state.cartError = text;
      renderWidget(state);
    });
  }

  function clearWarrantyCartErrors() {
    widgets.forEach((state) => {
      if (!state.cartError) return;
      state.cartError = "";
      renderWidget(state);
    });
  }

  function failedCartResponse(message, sourceResponse) {
    return new Response(
      JSON.stringify({
        status: 422,
        message,
        description: message,
      }),
      {
        status: sourceResponse?.status || 422,
        statusText: sourceResponse?.statusText || "Unprocessable Entity",
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  async function logWarrantyCartFailure(response, nestedBody) {
    if (!isEwDebugEnabled()) return;
    let bodyText = "";
    try {
      bodyText = await response.clone().text();
    } catch {
      bodyText = "";
    }
    console.error("[EW PDP] Warranty cart add failed", {
      cartRequestPayload: nestedBody,
      shopifyResponseStatus: response?.status || null,
      shopifyResponseBody: bodyText,
    });
  }

  function jsonResponse(data, sourceResponse) {
    return new Response(JSON.stringify(data), {
      status: sourceResponse.status,
      statusText: sourceResponse.statusText,
      headers: { "Content-Type": "application/json" },
    });
  }

  function notifyCartChanged(cart) {
    const itemCount = Number(cart?.item_count);
    const data = {
      itemCount: Number.isFinite(itemCount) ? itemCount : 0,
      item_count: Number.isFinite(itemCount) ? itemCount : 0,
      source: "pdp-extended-warranty",
    };
    if (cart?.sections) data.sections = cart.sections;
    if (cart?.items) data.items = cart.items;
    const detail = { data, resource: cart || null };
    const events = [
      [document, "cart:updated"],
      [document, "cart:refresh"],
      [document, "cart:update"],
      [document.documentElement, "cart:update"],
    ];
    for (const [target, type] of events) {
      try {
        target.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true, detail }));
      } catch (err) {
        ewDebug("[EW cart] Theme cart event failed", err);
      }
    }
    scheduleCartUi();
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
    scheduleCartUi();
    return jsonResponse(withSections, response);
  }

  function installCartHook() {
    if (cartHookInstalled || !nativeFetch) return;
    cartHookInstalled = true;

    window.fetch = async function ewPdpFetch(input, init) {
      if (ewInternal) return nativeFetch(input, init);

      if (isCartAddRequest(input, init)) {
        const wantsWarranty = warrantySelectionActive();
        try {
          const nestedBody = await interceptCartAdd(input, init);
          if (nestedBody) {
            const url = requestUrl(input);
            const rewrittenInit = buildFetchInit(input, init, nestedBody);
            const nestedResponse = await nativeFetch(url, rewrittenInit);
            if (nestedResponse.ok) {
              clearWarrantyCartErrors();
              scheduleCartUi();
              return nestedResponse;
            }
            await logWarrantyCartFailure(nestedResponse, nestedBody);
            showWarrantyCartError(WARRANTY_CART_ERROR);
            return nestedResponse;
          }
          if (wantsWarranty) {
            const requestBody = await parseCartRequest(input, init);
            const items = getRequestItems(requestBody || {});
            if (!items.some(isWarrantyLine)) {
              showWarrantyCartError(WARRANTY_CART_ERROR);
              return failedCartResponse(WARRANTY_CART_ERROR);
            }
          }
        } catch (error) {
          ewDebug("[EW PDP] Warranty cart preparation failed", error);
          if (wantsWarranty) {
            showWarrantyCartError(WARRANTY_CART_ERROR);
            return failedCartResponse(WARRANTY_CART_ERROR);
          }
        }
        const response = await nativeFetch(input, init);
        if (response.ok) scheduleCartUi();
        return response;
      }

      if (isCartMutateRequest(input, init)) {
        const requestBody = await parseCartRequest(input, init);
        try {
          await beforeCartMutation(requestBody);
        } catch (err) {
          ewDebug("[EW PDP] Pre-change warranty sync failed", err);
        }
        const response = await nativeFetch(input, init);
        try {
          return await handleMutateResponse(response, requestBody);
        } catch (err) {
          ewDebug("[EW PDP] Post-change warranty sync failed", err);
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
              xhr.addEventListener("load", () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                  clearWarrantyCartErrors();
                  scheduleCartUi();
                  return;
                }
                showWarrantyCartError(WARRANTY_CART_ERROR);
              });
              finishWithBody(nestedBody, true);
              return;
            }
            if (warrantySelectionActive()) {
              showWarrantyCartError(WARRANTY_CART_ERROR);
              try {
                xhr.abort();
              } catch {
                // Theme should not receive a product-only add.
              }
              return;
            }
            originalSend.call(xhr, body);
          })
          .catch((error) => {
            ewDebug("[EW PDP] Warranty cart preparation failed", error);
            if (warrantySelectionActive()) {
              showWarrantyCartError(WARRANTY_CART_ERROR);
              try {
                xhr.abort();
              } catch {
                // Theme should not receive a product-only add.
              }
              return;
            }
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
              if (cart) notifyCartChanged(cart);
            })
            .catch((err) => ewDebug("[EW PDP] XHR warranty sync failed", err));
        });
        parseBodyValue(body, "")
          .then((requestBody) => beforeCartMutation(requestBody))
          .catch((err) => ewDebug("[EW PDP] Pre-change warranty sync failed", err))
          .finally(() => originalSend.call(xhr, body));
        return;
      }

      return originalSend.call(this, body);
    };
  }

  function findLineAnchor(item) {
    const key = item?.key;
    const variantId = String(item?.variant_id || item?.id || "");
    if (key) {
      const name = `updates[${key}]`;
      const byKey =
        document.querySelector(`[name="${quoteAttr(name)}"]`) ||
        document.querySelector(`[data-cart-item-key="${quoteAttr(key)}"]`) ||
        document.querySelector(`[data-line-key="${quoteAttr(key)}"]`) ||
        document.querySelector(`[data-key="${quoteAttr(key)}"]`) ||
        document.querySelector(`a[href*="${encodeURIComponent(key)}"]`);
      if (byKey) return byKey;
    }
    if (!variantId) return null;
    return (
      document.querySelector(`[data-variant-id="${quoteAttr(variantId)}"]`) ||
      document.querySelector(`[data-product-variant-id="${quoteAttr(variantId)}"]`) ||
      document.querySelector(`[data-quantity-variant-id="${quoteAttr(variantId)}"]`)
    );
  }

  function closestLineRoot(el) {
    if (!el) return null;
    return (
      el.closest(
        "[data-cart-item-key], [data-line-key], [data-cart-item], [data-line-item], .cart-item, .cart-drawer-item, .cart-drawer__item, tr.cart-item, [id^='CartDrawer-Item-'], [id^='CartItem-']"
      ) || el.closest("li, tr, [class*='cart-item'], [class*='cart-line']")
    );
  }

  function productLineRoots() {
    const selector = [
      "[data-cart-item]",
      "[data-line-item]",
      ".cart-item",
      ".cart-drawer-item",
      ".cart-drawer__item",
      "tr.cart-item",
      "[id^='CartDrawer-Item-']",
      "[id^='CartItem-']",
    ].join(",");
    return [...document.querySelectorAll(selector)].filter((el) => {
      if (el.classList.contains("ew-cart-line-hidden")) return false;
      if (el.closest(".ew-cart-slot, .ew-pdp-modal, .ew-cart-fallback")) return false;
      return !el.parentElement?.closest(selector);
    });
  }

  function findLineRoot(item, cart) {
    const direct = closestLineRoot(findLineAnchor(item));
    if (direct && !direct.classList.contains("ew-cart-line-hidden")) return direct;

    const productItems = (cart?.items || []).filter((line) => !isWarrantyCatalogItem(line));
    const index = productItems.findIndex((line) => line.key === item.key);
    if (index < 0) return null;
    return productLineRoots()[index] || null;
  }

  function cartImage(item) {
    if (typeof item?.image === "string") return item.image;
    return item?.featured_image?.url || item?.image || "";
  }

  function slotMarkup(item, children) {
    if (children[0]) return "";
    return `<button type="button" class="ew-cart-add" data-ew-add-warranty="${escapeHtml(item.key)}" data-ew-product-id="${escapeHtml(item.product_id)}" data-ew-variant-id="${escapeHtml(item.variant_id || item.id)}" data-ew-title="${escapeHtml(item.product_title || item.title || "")}" data-ew-sku="${escapeHtml(item.sku || "")}" data-ew-image="${escapeHtml(cartImage(item))}">Add Warranty</button>`;
  }

  async function hydrateCartEligibility(cart) {
    const parents = (cart.items || []).filter((item) => {
      if (isWarrantyCatalogItem(item)) return false;
      return warrantyChildrenOf(cart, item).length === 0;
    });

    await Promise.all(
      parents.map(async (item) => {
        const offer = await loadCachedOffer({
          productId: item.product_id,
          variantId: item.variant_id || item.id,
          sku: item.sku,
          country: window.Shopify?.country || "",
        });
        if (!offer || (offer.eligible && offer.plans?.length)) return;
        const slot = document.querySelector(
          `.ew-cart-slot[data-ew-parent-key="${quoteAttr(item.key)}"]`
        );
        if (slot) slot.replaceChildren();
      })
    );
  }

  function cartFallbackHost() {
    const items =
      document.querySelector("cart-items, .cart-items, .cart-drawer__items, [data-cart-items], #CartDrawer-CartItems") ||
      document.querySelector("cart-drawer form, #CartDrawer form, form[action$='/cart'], form[action*='/cart']") ||
      document.querySelector("cart-drawer, #CartDrawer, .cart-drawer, [data-cart-drawer]");
    if (!items) return null;
    let host = items.querySelector("[data-ew-cart-fallback]");
    if (!host) {
      host = document.createElement("div");
      host.className = "ew-cart-fallback";
      host.dataset.ewCartFallback = "true";
      items.appendChild(host);
    }
    return host;
  }

  function upsertSlot(container, item, cart) {
    const html = slotMarkup(item, warrantyChildrenOf(cart, item));
    let slot = container.querySelector(`.ew-cart-slot[data-ew-parent-key="${quoteAttr(item.key)}"]`);
    if (!html) {
      if (slot) slot.remove();
      return;
    }
    if (!slot) {
      slot = document.createElement("div");
      slot.className = "ew-cart-slot";
      container.appendChild(slot);
    }
    slot.dataset.ewParentKey = item.key;
    if (slot.innerHTML !== html) slot.innerHTML = html;
    bindSlotActions(slot);
  }

  function bindSlotActions(slot) {
    slot.querySelectorAll("[data-ew-add-warranty]").forEach((btn) => {
      if (btn.dataset.ewBound === "true") return;
      btn.dataset.ewBound = "true";
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openCartWarrantyModal(btn.getAttribute("data-ew-add-warranty"), btn);
      });
    });
    slot.querySelectorAll("[data-ew-remove-warranty]").forEach((btn) => {
      if (btn.dataset.ewBound === "true") return;
      btn.dataset.ewBound = "true";
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        removeWarrantyLine(btn.getAttribute("data-ew-remove-warranty"));
      });
    });
  }

  function renderCartSlots(cart) {
    const liveKeys = new Set(
      (cart.items || []).filter((item) => !isWarrantyCatalogItem(item)).map((item) => item.key)
    );
    document.querySelectorAll(".ew-cart-slot").forEach((slot) => {
      if (!liveKeys.has(slot.dataset.ewParentKey)) slot.remove();
    });

    document.querySelectorAll(".ew-cart-line-hidden").forEach((el) => {
      el.classList.remove("ew-cart-line-hidden");
    });

    const missing = [];
    for (const item of cart.items || []) {
      if (isWarrantyCatalogItem(item)) continue;
      const root = findLineRoot(item, cart);
      if (!root) {
        missing.push(item);
        continue;
      }
      upsertSlot(root, item, cart);
    }

    const fallback = cartFallbackHost();
    if (fallback) {
      if (!missing.length) {
        if (fallback.innerHTML) fallback.replaceChildren();
      } else {
        missing.forEach((item) => upsertSlot(fallback, item, cart));
      }
    }
  }

  async function refreshCartUi() {
    if (cartUiRendering) return;
    cartUiRendering = true;
    try {
      const cart = await readCart();
      if (!cart) return;
      renderCartSlots(cart);
      await hydrateCartEligibility(cart);
    } finally {
      cartUiRendering = false;
    }
  }

  function scheduleCartUi() {
    clearTimeout(cartUiTimer);
    cartUiTimer = setTimeout(() => {
      refreshCartUi().catch((err) => ewDebug("[EW cart] UI refresh failed", err));
    }, 80);
  }

  async function addWarrantyToLine(parent, plan) {
    const cart = await readCart();
    if (!cart) throw new Error("Cart could not be loaded");
    const current = (cart.items || []).find((item) => item.key === parent.key) || parent;
    const existing = warrantyChildrenOf(cart, current);
    if (existing.some((child) => String(propertyMap(child)._ew_plan_id) === String(plan.planId))) {
      return cart;
    }

    for (const child of existing) {
      await setLineQuantity(child.key, 0);
    }

    const latest = (await readCart()) || cart;
    const latestParent = (latest?.items || []).find((item) => item.key === current.key) || current;
    const groupId = propertyMap(latestParent)._ew_group_id || createGroupId();
    const variantId = normalizeVariantId(latestParent.variant_id || latestParent.id);
    const payload = await fetchWarrantyPayload(
      {
        productId: latestParent.product_id,
        variantId,
        sku: latestParent.sku,
        country: window.Shopify?.country || "",
        groupId,
        parentLineKey: latestParent.key,
        source: "cart",
      },
      plan
    );

    const warrantyVariantId = normalizeVariantId(payload.variantId);
    if (!warrantyVariantId || warrantyVariantId === variantId) {
      throw new Error("Checkout variant not configured for this plan");
    }

    const previous = ewInternal;
    ewInternal = true;
    try {
      const response = await nativeFetch(cartEndpoint("add.js"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          items: [
            warrantyLinePayload(
              payload,
              plan,
              {
                productId: latestParent.product_id,
                parentLineKey: latestParent.key,
                source: "cart",
              },
              latestParent.quantity,
              variantId,
              groupId
            ),
          ],
        }),
      });
      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.description || errBody.message || "Failed to add warranty");
      }
      const next = await response.json();
      const parentAfterAdd =
        (next?.items || []).find((item) => item.key === latestParent.key) ||
        (next?.items || []).find((item) => {
          if (isWarrantyLine(item)) return false;
          return normalizeVariantId(item.variant_id || item.id) === variantId;
        }) ||
        latestParent;
      await updateLineProperties(parentAfterAdd, {
        _ew_plan_id: String(plan.planId),
        _ew_group_id: groupId,
      });
      const refreshed = await readCart();
      const reconciled = await reconcileCart(refreshed || next);
      const withSections = await cartWithSections(reconciled);
      notifyCartChanged(withSections);
      return withSections;
    } finally {
      ewInternal = previous;
    }
  }

  async function removeWarrantyLine(warrantyKey) {
    const cart = await readCart();
    if (!cart) return;
    const warranty = (cart.items || []).find((item) => item.key === warrantyKey);
    if (!warranty) return;
    const parent = findWarrantyParent(cart, warranty);
    await setLineQuantity(warrantyKey, 0);
    if (parent) {
      const props = { ...propertyMap(parent) };
      delete props._ew_plan_id;
      await replaceLineProperties(parent, props);
    }
    const refreshed = await readCart();
    const reconciled = await reconcileCart(refreshed || cart);
    const withSections = await cartWithSections(reconciled);
    notifyCartChanged(withSections);
  }

  function openCartWarrantyModal(parentKey, fromEl) {
    const productId = fromEl?.getAttribute("data-ew-product-id");
    const variantId = normalizeVariantId(fromEl?.getAttribute("data-ew-variant-id"));
    if (parentKey && productId && variantId) {
      openSharedModal({
        kind: "cart",
        productId,
        variantId,
        productTitle: fromEl.getAttribute("data-ew-title") || "",
        productImage: fromEl.getAttribute("data-ew-image") || "",
        sku: fromEl.getAttribute("data-ew-sku") || "",
        country: window.Shopify?.country || "",
        parentLineKey: parentKey,
        selectedPlanId: null,
      });
      return;
    }

    readCart().then((cart) => {
      const parent = (cart?.items || []).find((item) => item.key === parentKey);
      if (!parent || isWarrantyCatalogItem(parent)) return;
      openSharedModal({
        kind: "cart",
        productId: parent.product_id,
        variantId: normalizeVariantId(parent.variant_id || parent.id),
        productTitle: parent.product_title || parent.title || "",
        productImage: cartImage(parent),
        sku: parent.sku || "",
        country: window.Shopify?.country || "",
        parentLineKey: parent.key,
        quantity: parent.quantity,
        selectedPlanId: propertyMap(parent)._ew_plan_id || null,
        parent,
      });
    });
  }

  async function saveSharedModal() {
    const context = sharedModal.context;
    if (!context) return;
    const nextId = sharedModal.modalPlanId;

    if (context.kind === "pdp" && context.widget) {
      context.widget.selectedPlanId = nextId === NONE_PLAN_ID ? null : nextId;
      context.widget.cartError = "";
      renderWidget(context.widget);
      closeSharedModal();
      return;
    }

    if (context.kind === "cart") {
      if (nextId === NONE_PLAN_ID || !nextId) {
        closeSharedModal();
        return;
      }
      const plan = (sharedModal.offer?.plans || []).find(
        (item) => String(item.planId) === String(nextId)
      );
      if (!plan || !context.parentLineKey) {
        closeSharedModal();
        return;
      }
      sharedModal.saving = true;
      renderSharedModal();
      try {
        const cart = await readCart();
        const parent = (cart?.items || []).find((item) => item.key === context.parentLineKey);
        if (!parent) throw new Error("Cart line not found");
        await addWarrantyToLine(parent, plan);
        closeSharedModal();
      } catch (err) {
        ewDebug("[EW cart] Failed to add warranty", err);
        sharedModal.saving = false;
        const right = sharedModal.el?.querySelector(".ew-pdp-modal__right");
        if (right) {
          const status = document.createElement("p");
          status.className = "ew-pdp__status is-error";
          status.textContent = WARRANTY_CART_ERROR;
          right.appendChild(status);
        }
      }
    }
  }

  function onSharedModalClick(event) {
    if (closestFromEvent(event, "[data-ew-close-modal]")) {
      closeSharedModal();
      return;
    }
    const planButton = closestFromEvent(event, "[data-ew-modal-plan]");
    if (planButton) {
      sharedModal.modalPlanId = planButton.getAttribute("data-ew-modal-plan");
      renderSharedModal();
      return;
    }
    if (closestFromEvent(event, "[data-ew-save]")) {
      saveSharedModal();
    }
  }

  function onRootClick(state, event) {
    const planButton = event.target.closest("[data-ew-plan-id]");
    if (planButton) {
      const id = planButton.getAttribute("data-ew-plan-id");
      state.selectedPlanId = String(state.selectedPlanId) === String(id) ? null : id;
      state.cartError = "";
      renderWidget(state);
      return;
    }
    if (event.target.closest("[data-ew-open-modal]")) {
      openPdpModal(state);
    }
  }

  function onDocumentClick(event) {
    const addBtn = closestFromEvent(event, "[data-ew-add-warranty]");
    if (addBtn) {
      event.preventDefault();
      event.stopPropagation();
      openCartWarrantyModal(addBtn.getAttribute("data-ew-add-warranty"), addBtn);
      return;
    }
    const removeBtn = closestFromEvent(event, "[data-ew-remove-warranty]");
    if (removeBtn) {
      event.preventDefault();
      event.stopPropagation();
      removeWarrantyLine(removeBtn.getAttribute("data-ew-remove-warranty"));
    }
  }

  function notifyVariantChange(variantId) {
    const nextId = Number(variantId);
    if (!nextId) return;
    widgets.forEach((state) => {
      const belongs = state.variants.some((item) => Number(item.id) === nextId);
      if (!belongs && Number(state.variantId) !== nextId) return;
      if (nextId === Number(state.variantId)) return;
      loadForVariant(state, nextId, { keepSelection: true });
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

  function initCartUi() {
    if (cartUiInstalled) return;
    cartUiInstalled = true;

    document.addEventListener("click", onDocumentClick, true);
    document.addEventListener("cart:updated", scheduleCartUi);
    document.addEventListener("cart:refresh", scheduleCartUi);
    document.addEventListener("cart:open", scheduleCartUi);
    document.addEventListener("cart:update", scheduleCartUi);

    const observer = new MutationObserver((mutations) => {
      if (ewInternal || cartUiRendering) return;
      const relevant = mutations.some((mutation) => {
        const target = mutation.target;
        if (!(target instanceof Element)) return mutation.addedNodes.length > 0;
        if (target.closest(".ew-cart-slot, .ew-pdp-modal")) return false;
        return true;
      });
      if (relevant) scheduleCartUi();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    scheduleCartUi();
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
      requestGeneration: 0,
      hasRenderedPlans: false,
    };

    widgets.set(root.dataset.blockId, state);
    root.addEventListener("click", (event) => onRootClick(state, event));
    installVariantWatch();
    installCartHook();
    loadForVariant(state, resolveCurrentVariantId(state));
  }

  function initAll() {
    installCartHook();
    initCartUi();
    document.querySelectorAll("[data-ew-pdp-root]").forEach(initWidget);
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSharedModal();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAll);
  } else {
    initAll();
  }

  document.addEventListener("shopify:section:load", initAll);
  document.addEventListener("shopify:section:reorder", initAll);
})();
