// (() => {
//   const PROXY_OFFER = "/apps/warranty/extended-warranty/pdp-offer";
//   const PROXY_CART = "/apps/warranty/extended-warranty/pdp-cart-payload";
//   const NONE_PLAN_ID = "none";

//   const widgets = new Map();
//   let cartHookInstalled = false;
//   let variantWatchInstalled = false;
//   let attachingWarranty = false;

//   function escapeHtml(str) {
//     if (str == null || str === "") return "";
//     return String(str)
//       .replace(/&/g, "&amp;")
//       .replace(/</g, "&lt;")
//       .replace(/>/g, "&gt;")
//       .replace(/"/g, "&quot;");
//   }

//   function shopifyRoot() {
//     return window.Shopify?.routes?.root || "/";
//   }

//   function cartEndpoint(name) {
//     return `${shopifyRoot()}cart/${name}`.replace(/([^:]\/)\/+/g, "$1");
//   }

//   function formatPrice(price, currency) {
//     if (price == null || price === "") return "";
//     try {
//       return new Intl.NumberFormat(document.documentElement.lang || undefined, {
//         style: "currency",
//         currency: currency || "USD",
//       }).format(Number(price));
//     } catch {
//       return `${Number(price).toFixed(2)} ${currency || ""}`.trim();
//     }
//   }

//   function parseCoverageLines(text) {
//     return String(text || "")
//       .split("\n")
//       .map((line) => line.trim())
//       .filter(Boolean);
//   }

//   function isTwoYearPlan(plan) {
//     return (
//       plan.durationMonths === 24 ||
//       plan.durationYears === 2 ||
//       /\+?\s*2\s*(yr|year)/i.test(plan.planName || "")
//     );
//   }

//   function defaultPlanId(plans) {
//     const twoYear = plans.find(isTwoYearPlan);
//     return twoYear?.planId ?? plans[0]?.planId ?? null;
//   }

//   function parseVariants(root) {
//     try {
//       const node = root.querySelector("[data-ew-pdp-variants]");
//       return node ? JSON.parse(node.textContent || "[]") : [];
//     } catch {
//       return [];
//     }
//   }

//   function variantFromForm(productId) {
//     const forms = document.querySelectorAll('form[action*="/cart/add"]');
//     for (const form of forms) {
//       const idInput = form.querySelector('[name="id"]');
//       if (!idInput?.value) continue;
//       if (productId && form.querySelector(`[data-productid="${productId}"]`)) {
//         return idInput.value;
//       }
//       if (forms.length === 1) return idInput.value;
//     }
//     const fallback = document.querySelector('form[action*="/cart/add"] [name="id"]');
//     return fallback?.value || null;
//   }

//   function variantFromUrl() {
//     const value = new URLSearchParams(window.location.search).get("variant");
//     return value ? Number(value) : null;
//   }

//   /**
//    * Horizon updates ?variant= and may fire variant:update. Liquid does not
//    * re-render the app block, so the live form input is the add-to-cart source
//    * of truth when present.
//    */
//   function resolveCurrentVariantId(state) {
//     const formId = variantFromForm(state.productId);
//     if (formId) return Number(formId);
//     const urlId = variantFromUrl();
//     if (urlId) return urlId;
//     return Number(state.variantId);
//   }

//   function applyVariantMeta(state, variantId) {
//     const meta = state.variants.find((item) => Number(item.id) === Number(variantId));
//     state.variantId = Number(variantId);
//     if (meta) {
//       state.sku = meta.sku || state.sku;
//       state.variantTitle = meta.title || state.variantTitle;
//       if (meta.image) state.productImage = meta.image;
//     }
//   }

//   function labelFor(root, key, fallback) {
//     return root.dataset[key] || fallback;
//   }

//   function renderStatus(state, message, isError) {
//     state.root.hidden = false;
//     state.root.innerHTML = `<p class="ew-pdp__status${isError ? " is-error" : ""}">${escapeHtml(message)}</p>`;
//   }

//   function renderWidget(state) {
//     const plans = state.offer?.plans || [];
//     if (!plans.length) {
//       state.root.hidden = true;
//       state.root.innerHTML = "";
//       return;
//     }

//     const heading = labelFor(state.root, "heading", "Add Extended Warranty");
//     const coveredLabel = labelFor(state.root, "whatsCoveredLabel", "What's covered?");
//     const showCovered = state.root.dataset.showWhatsCovered !== "false";
//     const currency = state.offer.currency;

//     const cards = plans
//       .map((plan) => {
//         const selected = String(state.selectedPlanId) === String(plan.planId);
//         const badge = plan.badgeLabel
//           ? `<span class="ew-pdp__badge">${escapeHtml(plan.badgeLabel)}</span>`
//           : "";
//         return `
//           <button
//             type="button"
//             class="ew-pdp__card${selected ? " is-selected" : ""}"
//             data-ew-plan-id="${escapeHtml(plan.planId)}"
//             aria-pressed="${selected ? "true" : "false"}"
//           >
//             ${badge}
//             <span class="ew-pdp__card-name">${escapeHtml(plan.planName)}</span>
//             <span class="ew-pdp__card-price">${escapeHtml(formatPrice(plan.price, plan.currency || currency))}</span>
//           </button>
//         `;
//       })
//       .join("");

//     state.root.hidden = false;
//     state.root.innerHTML = `
//       <div class="ew-pdp__header">
//         <h3 class="ew-pdp__heading">${escapeHtml(heading)}</h3>
//         ${
//           showCovered
//             ? `<button type="button" class="ew-pdp__covered-link" data-ew-open-modal>${escapeHtml(coveredLabel)}</button>`
//             : ""
//         }
//       </div>
//       <div class="ew-pdp__plans">${cards}</div>
//     `;
//   }

//   function ensureModal(state) {
//     if (state.modal) return state.modal;
//     const modal = document.createElement("div");
//     modal.className = "ew-pdp-modal";
//     modal.hidden = true;
//     modal.innerHTML = `
//       <div class="ew-pdp-modal__backdrop" data-ew-close-modal></div>
//       <div class="ew-pdp-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="ew-pdp-modal-title-${state.root.dataset.blockId}">
//         <button type="button" class="ew-pdp-modal__close" data-ew-close-modal aria-label="Close">×</button>
//         <div class="ew-pdp-modal__left"></div>
//         <div class="ew-pdp-modal__right"></div>
//       </div>
//     `;
//     document.body.appendChild(modal);
//     state.modal = modal;
//     return modal;
//   }

//   function renderModal(state) {
//     const modal = ensureModal(state);
//     const offer = state.offer;
//     const plans = offer?.plans || [];
//     const coverage = parseCoverageLines(offer?.settings?.coverageText);
//     const draftId = state.modalPlanId ?? state.selectedPlanId ?? NONE_PLAN_ID;
//     const noneLabel = labelFor(state.root, "noneLabel", "No Extended Coverage");
//     const saveLabel = labelFor(state.root, "saveLabel", "SAVE");
//     const termsLabel = labelFor(state.root, "termsLabel", "Detailed Terms And Conditions");
//     const currency = offer?.currency;
//     const termsUrl = offer?.settings?.termsUrl;

//     const coverageHtml = coverage.length
//       ? `<ul class="ew-pdp-modal__coverage">${coverage
//           .map((line) => `<li>${escapeHtml(line)}</li>`)
//           .join("")}</ul>`
//       : `<p class="ew-pdp__status">Coverage details are listed in the terms and conditions.</p>`;

//     const planButtons = [
//       ...plans.map((plan) => {
//         const selected = String(draftId) === String(plan.planId);
//         const badge = plan.badgeLabel
//           ? `<span class="ew-pdp-modal__plan-badge">${escapeHtml(plan.badgeLabel)}</span>`
//           : "";
//         return `
//           <button type="button" class="ew-pdp-modal__plan${selected ? " is-selected" : ""}" data-ew-modal-plan="${escapeHtml(plan.planId)}">
//             ${badge}
//             <span class="ew-pdp-modal__plan-name">${escapeHtml(plan.planName)}</span>
//             <span class="ew-pdp-modal__plan-price">${escapeHtml(formatPrice(plan.price, plan.currency || currency))}</span>
//           </button>
//         `;
//       }),
//       `<button type="button" class="ew-pdp-modal__plan${String(draftId) === NONE_PLAN_ID ? " is-selected" : ""}" data-ew-modal-plan="${NONE_PLAN_ID}">
//         <span class="ew-pdp-modal__plan-name">${escapeHtml(noneLabel)}</span>
//         <span class="ew-pdp-modal__plan-price"></span>
//       </button>`,
//     ].join("");

//     modal.querySelector(".ew-pdp-modal__left").innerHTML = `
//       <h2 class="ew-pdp-modal__kicker" id="ew-pdp-modal-title-${state.root.dataset.blockId}">What's Included?</h2>
//       ${coverageHtml}
//     `;

//     modal.querySelector(".ew-pdp-modal__right").innerHTML = `
//       <div class="ew-pdp-modal__product">
//         ${
//           state.productImage
//             ? `<img src="${escapeHtml(state.productImage)}" alt="${escapeHtml(state.productTitle)}">`
//             : ""
//         }
//         <h3 class="ew-pdp-modal__product-title">${escapeHtml(state.productTitle)}</h3>
//       </div>
//       <p class="ew-pdp-modal__select-label">Select a coverage plan</p>
//       <div class="ew-pdp-modal__plan-list">${planButtons}</div>
//       <button type="button" class="ew-pdp-modal__save" data-ew-save>${escapeHtml(saveLabel)}</button>
//       <div class="ew-pdp-modal__footer">
//         <span></span>
//         ${
//           termsUrl
//             ? `<a class="ew-pdp-modal__terms" href="${escapeHtml(termsUrl)}" target="_blank" rel="noopener">${escapeHtml(termsLabel)}</a>`
//             : `<span></span>`
//         }
//       </div>
//     `;
//   }

//   function openModal(state) {
//     if (!state.offer?.eligible) return;
//     state.modalPlanId = state.selectedPlanId || NONE_PLAN_ID;
//     renderModal(state);
//     ensureModal(state).hidden = false;
//     document.body.classList.add("ew-pdp-modal-open");
//   }

//   function closeModal(state) {
//     if (!state.modal) return;
//     state.modal.hidden = true;
//     document.body.classList.remove("ew-pdp-modal-open");
//   }

//   async function fetchOffer(state, variantId) {
//     const generation = ++state.requestGeneration;
//     const params = new URLSearchParams({
//       product_id: String(state.productId),
//       variant_id: String(variantId || ""),
//     });
//     if (state.sku) params.set("sku", state.sku);
//     if (state.country) params.set("country", state.country);

//     const response = await fetch(`${PROXY_OFFER}?${params.toString()}`, {
//       headers: { Accept: "application/json" },
//     });
//     // The backend remains the source of truth for eligibility and price.
//     // The storefront only displays the values returned here.
//     const data = await response.json().catch(() => ({}));
//     if (generation !== state.requestGeneration) return null;
//     if (!response.ok) {
//       throw new Error(data.error || "Failed to load warranty plans");
//     }
//     return data;
//   }

//   async function loadForVariant(state, variantId, { keepSelection } = {}) {
//     applyVariantMeta(state, variantId);
//     renderStatus(state, labelFor(state.root, "loadingLabel", "Loading warranty options..."), false);

//     try {
//       const offer = await fetchOffer(state, variantId);
//       if (!offer) return;

//       state.offer = offer;
//       if (!offer.eligible || !offer.plans?.length) {
//         state.selectedPlanId = null;
//         if (state.hasRenderedPlans) {
//           renderStatus(
//             state,
//             labelFor(state.root, "emptyLabel", "Extended warranty is not available"),
//             false
//           );
//         } else {
//           state.root.hidden = true;
//           state.root.innerHTML = "";
//         }
//         return;
//       }

//       if (keepSelection && offer.plans.some((plan) => String(plan.planId) === String(state.selectedPlanId))) {
//         // Keep the customer's choice when the same plan still exists.
//       } else {
//         state.selectedPlanId = defaultPlanId(offer.plans);
//       }

//       state.hasRenderedPlans = true;
//       renderWidget(state);
//       if (state.modal && !state.modal.hidden) {
//         state.modalPlanId = state.selectedPlanId;
//         renderModal(state);
//       }
//     } catch (err) {
//       // Leave Add to Cart usable even if the warranty API is down.
//       console.warn("[EW PDP] offer failed; product purchase remains available", err);
//       state.offer = null;
//       state.selectedPlanId = null;
//       renderStatus(
//         state,
//         labelFor(state.root, "errorLabel", "Warranty options could not be loaded"),
//         true
//       );
//     }
//   }

//   function selectedPlan(state) {
//     if (!state.selectedPlanId || state.selectedPlanId === NONE_PLAN_ID) return null;
//     return (state.offer?.plans || []).find(
//       (plan) => String(plan.planId) === String(state.selectedPlanId)
//     );
//   }

//   function quantityFromContext() {
//     const input = document.querySelector('form[action*="/cart/add"] [name="quantity"]');
//     const value = Number(input?.value || 1);
//     return Number.isFinite(value) && value > 0 ? value : 1;
//   }

//   function isWarrantyLine(item) {
//     const props = item.properties || {};
//     return props._ew_type === "extended_warranty" || Boolean(item.parent_relationship);
//   }

//   async function readCart() {
//     const response = await fetch(cartEndpoint("cart.js"), {
//       headers: { Accept: "application/json" },
//     });
//     if (!response.ok) return null;
//     return response.json();
//   }

//   async function attachWarrantyToCart(state, parentKey, quantity) {
//     const plan = selectedPlan(state);
//     if (!plan) return;

//     const payloadRes = await fetch(PROXY_CART, {
//       method: "POST",
//       headers: { "Content-Type": "application/json", Accept: "application/json" },
//       body: JSON.stringify({
//         product_id: state.productId,
//         variant_id: state.variantId,
//         plan_id: plan.planId,
//         sku: state.sku,
//         country: state.country,
//       }),
//     });
//     const payload = await payloadRes.json().catch(() => ({}));
//     if (!payloadRes.ok || !payload.variantId) return;

//     attachingWarranty = true;
//     try {
//       // Nested cart lines (Shopify Cart AJAX, 2025-10+) keep the warranty
//       // child bound to this product line through checkout and the order.
//       const addRes = await fetch(cartEndpoint("add.js"), {
//         method: "POST",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({
//           items: [
//             {
//               id: Number(payload.variantId),
//               quantity: quantity || 1,
//               parent_line_key: parentKey,
//               properties: payload.properties || {},
//             },
//           ],
//         }),
//       });
//       if (!addRes.ok && parentKey) {
//         await fetch(cartEndpoint("add.js"), {
//           method: "POST",
//           headers: { "Content-Type": "application/json" },
//           body: JSON.stringify({
//             items: [
//               {
//                 id: Number(payload.variantId),
//                 quantity: quantity || 1,
//                 parent_id: Number(state.variantId),
//                 properties: payload.properties || {},
//               },
//             ],
//           }),
//         });
//       }
//     } finally {
//       attachingWarranty = false;
//     }
//   }

//   async function syncWarrantyAfterProductAdd(addPayload) {
//     if (attachingWarranty) return;

//     const addedItems = addPayload?.items || (addPayload?.id ? [addPayload] : []);
//     for (const widgetState of widgets.values()) {
//       const plan = selectedPlan(widgetState);
//       if (!plan) continue;

//       const parent = addedItems.find(
//         (item) =>
//           Number(item.variant_id || item.id) === Number(widgetState.variantId) &&
//           !isWarrantyLine(item)
//       );
//       if (!parent) continue;

//       // Warranty quantity tracks the product line quantity so a qty-3 add
//       // purchases 3 warranty units for later per-serial registration.
//       try {
//         await attachWarrantyToCart(
//           widgetState,
//           parent.key,
//           parent.quantity || quantityFromContext()
//         );
//       } catch (err) {
//         console.warn("[EW PDP] warranty cart attach failed", err);
//       }
//     }
//   }

//   function parseCartAddBody(init) {
//     if (!init?.body) return null;
//     if (typeof init.body === "string") {
//       try {
//         return JSON.parse(init.body);
//       } catch {
//         return null;
//       }
//     }
//     return null;
//   }

//   function isCartAddRequest(input) {
//     const url = String(typeof input === "string" ? input : input?.url || "");
//     return /\/cart\/add(\.js)?(\?|$)/.test(url);
//   }

//   function installCartHook() {
//     if (cartHookInstalled || typeof window.fetch !== "function") return;
//     cartHookInstalled = true;
//     const nativeFetch = window.fetch.bind(window);

//     window.fetch = async function ewPdpFetch(input, init) {
//       const response = await nativeFetch(input, init);
//       if (!isCartAddRequest(input) || attachingWarranty) return response;

//       try {
//         const cloned = response.clone();
//         const body = await cloned.json();
//         const requestBody = parseCartAddBody(init);
//         const requestItems = requestBody?.items || (requestBody?.id ? [requestBody] : []);
//         const addingWarranty = requestItems.some(
//           (item) => item?.properties?._ew_type === "extended_warranty"
//         );
//         if (!addingWarranty) {
//           await syncWarrantyAfterProductAdd(body);
//         }
//       } catch (err) {
//         console.warn("[EW PDP] cart intercept skipped", err);
//       }
//       return response;
//     };
//   }

//   function onRootClick(state, event) {
//     const planButton = event.target.closest("[data-ew-plan-id]");
//     if (planButton) {
//       state.selectedPlanId = planButton.getAttribute("data-ew-plan-id");
//       renderWidget(state);
//       return;
//     }
//     if (event.target.closest("[data-ew-open-modal]")) {
//       openModal(state);
//     }
//   }

//   function onModalClick(state, event) {
//     if (event.target.closest("[data-ew-close-modal]")) {
//       closeModal(state);
//       return;
//     }
//     const planButton = event.target.closest("[data-ew-modal-plan]");
//     if (planButton) {
//       state.modalPlanId = planButton.getAttribute("data-ew-modal-plan");
//       renderModal(state);
//       return;
//     }
//     if (event.target.closest("[data-ew-save]")) {
//       const nextId = state.modalPlanId;
//       state.selectedPlanId = nextId === NONE_PLAN_ID ? null : nextId;
//       renderWidget(state);
//       closeModal(state);
//     }
//   }

//   function notifyVariantChange(variantId) {
//     const nextId = Number(variantId);
//     if (!nextId) return;
//     widgets.forEach((state) => {
//       if (nextId === Number(state.variantId)) return;
//       loadForVariant(state, nextId);
//     });
//   }

//   function installVariantWatch() {
//     if (variantWatchInstalled) return;
//     variantWatchInstalled = true;

//     document.addEventListener("variant:update", (event) => {
//       const id =
//         event.detail?.variant?.id ||
//         event.detail?.data?.variant?.id ||
//         event.detail?.id;
//       if (id) notifyVariantChange(id);
//     });

//     document.addEventListener("change", (event) => {
//       const target = event.target;
//       if (!target) return;
//       if (target.name === "id" && target.closest?.('form[action*="/cart/add"]')) {
//         notifyVariantChange(target.value);
//       }
//     });

//     const urlCheck = () => {
//       const urlId = variantFromUrl();
//       if (urlId) notifyVariantChange(urlId);
//     };
//     window.addEventListener("popstate", urlCheck);

//     if (!history.pushState.__ewPdpWrapped) {
//       const originalPush = history.pushState;
//       const originalReplace = history.replaceState;
//       history.pushState = function (...args) {
//         const result = originalPush.apply(this, args);
//         urlCheck();
//         return result;
//       };
//       history.replaceState = function (...args) {
//         const result = originalReplace.apply(this, args);
//         urlCheck();
//         return result;
//       };
//       history.pushState.__ewPdpWrapped = true;
//     }
//   }

//   function initWidget(root) {
//     if (root.dataset.ewReady === "true") return;
//     root.dataset.ewReady = "true";

//     const state = {
//       root,
//       productId: Number(root.dataset.productId),
//       productTitle: root.dataset.productTitle || "",
//       variantId: Number(root.dataset.variantId),
//       sku: root.dataset.variantSku || "",
//       variantTitle: root.dataset.variantTitle || "",
//       productImage: root.dataset.productImage || "",
//       country: root.dataset.country || "",
//       currency: root.dataset.currency || "",
//       variants: parseVariants(root),
//       offer: null,
//       selectedPlanId: null,
//       modalPlanId: null,
//       modal: null,
//       requestGeneration: 0,
//       hasRenderedPlans: false,
//     };

//     widgets.set(root.dataset.blockId, state);
//     root.addEventListener("click", (event) => onRootClick(state, event));
//     document.addEventListener("click", (event) => {
//       if (state.modal && event.target.closest(".ew-pdp-modal") === state.modal) {
//         onModalClick(state, event);
//       }
//     });
//     document.addEventListener("keydown", (event) => {
//       if (event.key === "Escape") closeModal(state);
//     });

//     installVariantWatch();
//     installCartHook();
//     loadForVariant(state, resolveCurrentVariantId(state));
//   }

//   function initAll() {
//     document.querySelectorAll("[data-ew-pdp-root]").forEach(initWidget);
//   }

//   if (document.readyState === "loading") {
//     document.addEventListener("DOMContentLoaded", initAll);
//   } else {
//     initAll();
//   }

//   document.addEventListener("shopify:section:load", initAll);
//   document.addEventListener("shopify:section:reorder", initAll);
// })();
(() => {
  const PROXY_OFFER = "/apps/warranty/extended-warranty/pdp-offer";
  const PROXY_CART = "/apps/warranty/extended-warranty/pdp-cart-payload";
  const NONE_PLAN_ID = "none";

  const widgets = new Map();
  let cartHookInstalled = false;
  let variantWatchInstalled = false;
  let attachingWarranty = false;

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
    const name = state.providerName ;
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
    // The backend remains the source of truth for eligibility and price.
    // The storefront only displays the values returned here.
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
      // Leave Add to Cart usable even if the warranty API is down.
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

  function isWarrantyLine(item) {
    const props = item.properties || {};
    return props._ew_type === "extended_warranty" || Boolean(item.parent_relationship);
  }

  async function readCart() {
    const response = await fetch(cartEndpoint("cart.js"), {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    return response.json();
  }

  async function attachWarrantyToCart(state, parentKey, quantity) {
    const plan = selectedPlan(state);
    if (!plan) return;

    const payloadRes = await fetch(PROXY_CART, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        product_id: state.productId,
        variant_id: state.variantId,
        plan_id: plan.planId,
        sku: state.sku,
        country: state.country,
      }),
    });
    const payload = await payloadRes.json().catch(() => ({}));
    if (!payloadRes.ok || !payload.variantId) return;

    attachingWarranty = true;
    try {
      // Nested cart lines (Shopify Cart AJAX, 2025-10+) keep the warranty
      // child bound to this product line through checkout and the order.
      const addRes = await fetch(cartEndpoint("add.js"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [
            {
              id: Number(payload.variantId),
              quantity: quantity || 1,
              parent_line_key: parentKey,
              properties: payload.properties || {},
            },
          ],
        }),
      });
      if (!addRes.ok && parentKey) {
        await fetch(cartEndpoint("add.js"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: [
              {
                id: Number(payload.variantId),
                quantity: quantity || 1,
                parent_id: Number(state.variantId),
                properties: payload.properties || {},
              },
            ],
          }),
        });
      }
    } finally {
      attachingWarranty = false;
    }
  }

  async function syncWarrantyAfterProductAdd(addPayload) {
    if (attachingWarranty) return;

    const addedItems = addPayload?.items || (addPayload?.id ? [addPayload] : []);
    for (const widgetState of widgets.values()) {
      const plan = selectedPlan(widgetState);
      if (!plan) continue;

      const parent = addedItems.find(
        (item) =>
          Number(item.variant_id || item.id) === Number(widgetState.variantId) &&
          !isWarrantyLine(item)
      );
      if (!parent) continue;

      // Warranty quantity tracks the product line quantity so a qty-3 add
      // purchases 3 warranty units for later per-serial registration.
      try {
        await attachWarrantyToCart(widgetState, parent.key, parent.quantity || quantityFromContext());
      } catch (err) {
        console.warn("[EW PDP] warranty cart attach failed", err);
      }
    }
  }

  function parseCartAddBody(init) {
    if (!init?.body) return null;
    if (typeof init.body === "string") {
      try {
        return JSON.parse(init.body);
      } catch {
        return null;
      }
    }
    return null;
  }

  function isCartAddRequest(input) {
    const url = String(typeof input === "string" ? input : input?.url || "");
    return /\/cart\/add(\.js)?(\?|$)/.test(url);
  }

  function installCartHook() {
    if (cartHookInstalled || typeof window.fetch !== "function") return;
    cartHookInstalled = true;
    const nativeFetch = window.fetch.bind(window);

    window.fetch = async function ewPdpFetch(input, init) {
      const response = await nativeFetch(input, init);
      if (!isCartAddRequest(input) || attachingWarranty) return response;

      try {
        const cloned = response.clone();
        const body = await cloned.json();
        const requestBody = parseCartAddBody(init);
        const requestItems = requestBody?.items || (requestBody?.id ? [requestBody] : []);
        const addingWarranty = requestItems.some(
          (item) => item?.properties?._ew_type === "extended_warranty"
        );
        if (!addingWarranty) {
          await syncWarrantyAfterProductAdd(body);
        }
      } catch (err) {
        console.warn("[EW PDP] cart intercept skipped", err);
      }
      return response;
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
      const id = event.detail?.variant?.id || event.detail?.data?.variant?.id || event.detail?.id;
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
