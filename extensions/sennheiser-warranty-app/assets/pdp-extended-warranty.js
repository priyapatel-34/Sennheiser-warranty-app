// (() => {
//   if (window.__SENNH_EW_PDP_NESTED__) return;
//   window.__SENNH_EW_PDP_NESTED__ = true;

//   const PROXY_OFFER = "/apps/warranty/extended-warranty/pdp-offer";
//   const PROXY_CART = "/apps/warranty/extended-warranty/pdp-cart-payload";
//   const NONE_PLAN_ID = "none";
//   const WARRANTY_CART_ERROR =
//     "We couldn't add the selected extended warranty to your cart. Please try again or select another warranty option.";

//   const widgets = new Map();
//   const offerCache = new Map();
//   let cartHookInstalled = false;
//   let variantWatchInstalled = false;
//   let cartUiInstalled = false;
//   let nativeFetch = typeof window.fetch === "function" ? window.fetch.bind(window) : null;
//   let ewInternal = false;
//   let reconciling = false;
//   let cartUiTimer = null;
//   let cartUiRendering = false;

//   const sharedModal = {
//     el: null,
//     context: null,
//     offer: null,
//     modalPlanId: null,
//     requestGeneration: 0,
//     saving: false,
//   };

//   function escapeHtml(str) {
//     if (str == null || str === "") return "";
//     return String(str)
//       .replace(/&/g, "&amp;")
//       .replace(/</g, "&lt;")
//       .replace(/>/g, "&gt;")
//       .replace(/"/g, "&quot;");
//   }

//   function quoteAttr(value) {
//     return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
//   }

//   function shopifyRoot() {
//     const root = window.Shopify?.routes?.root || "/";
//     return root.endsWith("/") ? root : `${root}/`;
//   }

//   /**
//    * Shopify Ajax Cart API:
//    * GET  /cart.js
//    * POST /cart/add.js, /cart/change.js, /cart/update.js, /cart/clear.js
//    */
//   function cartEndpoint(name) {
//     const root = shopifyRoot();
//     const file = String(name || "").replace(/^\/+/, "");
//     const path = file === "cart.js" || file === "js" ? "cart.js" : `cart/${file.replace(/^cart\//, "")}`;
//     return `${root}${path}`.replace(/([^:]\/)\/+/g, "$1");
//   }

//   function isTwoYearPlan(plan) {
//     return (
//       Number(plan?.durationMonths) === 24 ||
//       Number(plan?.durationYears) === 2 ||
//       /\+?\s*2\s*(yr|year)/i.test(plan?.planName || "")
//     );
//   }

//   function defaultPlanId(plans) {
//     if (!plans?.length) return null;
//     const twoYear = plans.find(isTwoYearPlan);
//     return twoYear?.planId ?? plans[0]?.planId ?? null;
//   }

//   function resolveDraftPlanId(plans, existingId) {
//     if (existingId && existingId !== NONE_PLAN_ID) {
//       const match = (plans || []).find((plan) => String(plan.planId) === String(existingId));
//       if (match) return match.planId;
//     }
//     return defaultPlanId(plans) || NONE_PLAN_ID;
//   }

//   function isEwDebugEnabled() {
//     try {
//       if (window.__EW_PDP_DEBUG) return true;
//       if (window.Shopify?.designMode) return true;
//       return new URLSearchParams(window.location.search).get("ew_debug") === "1";
//     } catch {
//       return false;
//     }
//   }

//   function ewDebug(...args) {
//     if (isEwDebugEnabled()) console.log(...args);
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

//   function createGroupId() {
//     if (crypto?.randomUUID) return crypto.randomUUID();
//     return `ew_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
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
//     return root?.dataset?.[key] || fallback;
//   }

//   function defaultLabels(root) {
//     return {
//       noneLabel: labelFor(root, "noneLabel", "No Extended Coverage"),
//       saveLabel: labelFor(root, "saveLabel", "SAVE"),
//       termsLabel: labelFor(root, "termsLabel", "Detailed Terms And Conditions"),
//       footerNote: labelFor(
//         root,
//         "footerNote",
//         "Let us handle the worries, and you enjoy your purchase!"
//       ),
//       trustLabel: labelFor(root, "trustLabel", "Trusted by 100K+ customers"),
//       loadingLabel: labelFor(root, "loadingLabel", "Loading warranty options..."),
//       emptyLabel: labelFor(root, "emptyLabel", "Extended warranty is not available"),
//       errorLabel: labelFor(root, "errorLabel", "Warranty options could not be loaded"),
//       shopLogo: root?.dataset?.shopLogo || "",
//       shopName: root?.dataset?.shopName || "SENNHEISER",
//     };
//   }

//   function offerUnavailableMessage(offer, labels) {
//     if (!offer) return labels.errorLabel;
//     if (offer.reason === "pricing_unavailable") {
//       return offer.message || "Warranty price could not be calculated for this product variant.";
//     }
//     if (offer.reason === "pricing_type_unconfigured") {
//       return offer.message || "Warranty pricing is not configured.";
//     }
//     return labels.emptyLabel;
//   }

//   function renderStatus(state, message, isError) {
//     state.root.hidden = false;
//     state.root.innerHTML = `<p class="ew-pdp__status${isError ? " is-error" : ""}">${escapeHtml(message)}</p>`;
//   }

//   function providerMarkup(state, className) {
//     const logo = state.providerLogo;
//     const name = state.providerName;
//     return logo
//       ? `<span class="${className}"><img src="${escapeHtml(logo)}" alt="${escapeHtml(name)}"></span>`
//       : `<span class="${className}">${escapeHtml(name)}</span>`;
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
//         ${showCovered
//         ? `<button type="button" class="ew-pdp__covered-link" data-ew-open-modal>${escapeHtml(coveredLabel)}</button>`
//         : ""
//       }
//         ${providerMarkup(state, "ew-pdp__brand")}
//       </div>
//       <div class="ew-pdp__plans">${cards}</div>
//       ${state.cartError
//         ? `<p class="ew-pdp__status is-error" data-ew-cart-error>${escapeHtml(state.cartError)}</p>`
//         : ""
//       }
//     `;
//   }

//   function closestFromEvent(event, selector) {
//     const path = typeof event.composedPath === "function" ? event.composedPath() : [];
//     for (const node of path) {
//       if (!(node instanceof Element)) continue;
//       if (node.matches(selector)) return node;
//       const nested = node.closest(selector);
//       if (nested) return nested;
//     }
//     const target = event.target;
//     return target instanceof Element ? target.closest(selector) : null;
//   }

//   function ensureSharedModal() {
//     if (sharedModal.el) return sharedModal.el;
//     const modal = document.createElement("dialog");
//     modal.className = "ew-pdp-modal";
//     modal.setAttribute("aria-modal", "true");
//     modal.innerHTML = `
//       <div class="ew-pdp-modal__backdrop" data-ew-close-modal></div>
//       <div class="ew-pdp-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="ew-pdp-modal-title">
//         <button type="button" class="ew-pdp-modal__close" data-ew-close-modal aria-label="Close">×</button>
//         <div class="ew-pdp-modal__left"></div>
//         <div class="ew-pdp-modal__right"></div>
//         <div class="ew-pdp-modal__footer"></div>
//       </div>
//     `;
//     document.body.appendChild(modal);
//     modal.addEventListener("click", onSharedModalClick);
//     modal.addEventListener("cancel", (event) => {
//       event.preventDefault();
//       closeSharedModal();
//     });
//     sharedModal.el = modal;
//     return modal;
//   }

//   function modalLabels() {
//     return defaultLabels(sharedModal.context?.widget?.root || document.querySelector("[data-ew-pdp-root]"));
//   }

//   function renderSharedModal() {
//     const modal = ensureSharedModal();
//     const context = sharedModal.context;
//     if (!context) return;

//     const labels = modalLabels();
//     const offer = sharedModal.offer;
//     const plans = offer?.plans || [];
//     const coverage = parseCoverageLines(offer?.settings?.coverageText);
//     const draftId = sharedModal.modalPlanId ?? NONE_PLAN_ID;
//     const currency = offer?.currency;
//     const termsUrl = offer?.settings?.termsUrl;
//     const productTitle = context.productTitle || "";
//     const productImage = context.productImage || "";

//     const coverageHtml = coverage.length
//       ? `<ul class="ew-pdp-modal__coverage">${coverage
//         .map((line) => `<li>${escapeHtml(line)}</li>`)
//         .join("")}</ul>`
//       : `<p class="ew-pdp__status">Coverage details are listed in the terms and conditions.</p>`;

//     modal.querySelector(".ew-pdp-modal__left").innerHTML = `
//       <h2 class="ew-pdp-modal__kicker" id="ew-pdp-modal-title">What's Included?</h2>
//       ${coverageHtml}
//       <div class="ew-pdp-modal__trust">
//         <div class="ew-pdp-modal__stars" aria-hidden="true">★★★★★</div>
//         <p class="ew-pdp-modal__trust-text">${escapeHtml(labels.trustLabel)}</p>
//         <div class="ew-pdp-modal__brands">
//           ${labels.shopLogo
//         ? `<img src="${escapeHtml(labels.shopLogo)}" alt="${escapeHtml(labels.shopName)}">`
//         : `<span>${escapeHtml(labels.shopName)}</span>`
//       }
//         </div>
//       </div>
//     `;

//     let rightHtml;
//     if (!offer) {
//       rightHtml = `<p class="ew-pdp__status">${escapeHtml(labels.loadingLabel)}</p>`;
//     } else if (offer.error) {
//       rightHtml = `<p class="ew-pdp__status is-error">${escapeHtml(labels.errorLabel)}</p>`;
//     } else if (!offer.eligible || !plans.length) {
//       rightHtml = `<p class="ew-pdp__status">${escapeHtml(offerUnavailableMessage(offer, labels))}</p>`;
//     } else {
//       const planButtons = [
//         ...plans.map((plan) => {
//           const selected = String(draftId) === String(plan.planId);
//           const badge = plan.badgeLabel
//             ? `<span class="ew-pdp-modal__plan-badge">${escapeHtml(plan.badgeLabel)}</span>`
//             : "";
//           return `
//             <button type="button" class="ew-pdp-modal__plan${selected ? " is-selected" : ""}" data-ew-modal-plan="${escapeHtml(plan.planId)}" aria-pressed="${selected ? "true" : "false"}">
//               ${badge}
//               <span class="ew-pdp-modal__plan-name">${escapeHtml(plan.planName)}</span>
//               <span class="ew-pdp-modal__plan-price">${escapeHtml(formatPrice(plan.price, plan.currency || currency))}</span>
//             </button>
//           `;
//         }),
//         `<button type="button" class="ew-pdp-modal__plan${String(draftId) === NONE_PLAN_ID ? " is-selected" : ""}" data-ew-modal-plan="${NONE_PLAN_ID}" aria-pressed="${String(draftId) === NONE_PLAN_ID ? "true" : "false"}">
//           <span class="ew-pdp-modal__plan-name">${escapeHtml(labels.noneLabel)}</span>
//           <span class="ew-pdp-modal__plan-price"></span>
//         </button>`,
//       ].join("");

//       rightHtml = `
//         <div class="ew-pdp-modal__product">
//           <h3 class="ew-pdp-modal__product-title">${escapeHtml(productTitle)}</h3>
//           ${productImage ? `<img src="${escapeHtml(productImage)}" alt="${escapeHtml(productTitle)}">` : ""}
//         </div>
//         <p class="ew-pdp-modal__select-label">Select a coverage plan</p>
//         <div class="ew-pdp-modal__plan-list">${planButtons}</div>
//         <button type="button" class="ew-pdp-modal__save" data-ew-save${sharedModal.saving ? " disabled" : ""}>${escapeHtml(labels.saveLabel)}</button>
//       `;
//     }

//     modal.querySelector(".ew-pdp-modal__right").innerHTML = rightHtml;
//     modal.querySelector(".ew-pdp-modal__footer").innerHTML = `
//       <p>${escapeHtml(labels.footerNote)}</p>
//       ${termsUrl
//         ? `<a class="ew-pdp-modal__terms" href="${escapeHtml(termsUrl)}" target="_blank" rel="noopener">${escapeHtml(labels.termsLabel)}</a>`
//         : `<span></span>`
//       }
//     `;
//   }

//   function closeSharedModal() {
//     const modal = sharedModal.el;
//     if (!modal) return;
//     if (typeof modal.close === "function" && modal.open) {
//       modal.close();
//     }
//     modal.hidden = true;
//     document.body.classList.remove("ew-pdp-modal-open");
//     sharedModal.saving = false;
//   }

//   function resetSharedModal(context) {
//     sharedModal.context = context;
//     sharedModal.offer = context.offer || null;
//     sharedModal.modalPlanId = resolveDraftPlanId(context.offer?.plans, context.selectedPlanId);
//     sharedModal.saving = false;
//     sharedModal.requestGeneration += 1;
//   }

//   async function openSharedModal(context) {
//     resetSharedModal(context);
//     const modal = ensureSharedModal();
//     renderSharedModal();
//     modal.hidden = false;
//     try {
//       if (typeof modal.showModal === "function" && !modal.open) modal.showModal();
//     } catch {
//       modal.setAttribute("open", "");
//     }
//     document.body.classList.add("ew-pdp-modal-open");

//     if (sharedModal.offer) return;

//     try {
//       // Cart items are prefetched by hydrateCartEligibility(). Reuse the
//       // existing cached/pending promise instead of starting a second offer
//       // request when the customer clicks Add Warranty.
//       const offer =
//         context.kind === "cart"
//           ? await loadCachedOffer(context)
//           : await requestOffer(context, sharedModal);
//       if (!offer || sharedModal.context !== context) return;
//       sharedModal.offer = offer;
//       if (context.kind === "pdp" && context.widget) {
//         context.widget.offer = offer;
//       }
//       sharedModal.modalPlanId = resolveDraftPlanId(offer?.plans, context.selectedPlanId);
//       renderSharedModal();
//     } catch {
//       if (sharedModal.context !== context) return;
//       sharedModal.offer = { eligible: false, error: true };
//       renderSharedModal();
//     }
//   }

//   function openPdpModal(state) {
//     if (!state.offer?.eligible) return;
//     openSharedModal({
//       kind: "pdp",
//       widget: state,
//       productId: state.productId,
//       variantId: state.variantId,
//       productTitle: state.productTitle,
//       productImage: state.productImage,
//       sku: state.sku,
//       country: state.country,
//       offer: state.offer,
//       selectedPlanId: state.selectedPlanId,
//     });
//   }

//   async function requestOffer({ productId, variantId, sku, country }, generationHolder) {
//     const generation = ++generationHolder.requestGeneration;
//     const params = new URLSearchParams({
//       product_id: String(productId),
//       variant_id: String(variantId || ""),
//     });
//     if (sku) params.set("sku", sku);
//     if (country) params.set("country", country);

//     const response = await fetch(`${PROXY_OFFER}?${params.toString()}`, {
//       headers: { Accept: "application/json" },
//     });
//     const data = await response.json().catch(() => ({}));
//     if (generation !== generationHolder.requestGeneration) return null;
//     if (!response.ok) {
//       throw new Error(data.error || "Failed to load warranty plans");
//     }
//     return data;
//   }

//   function cacheKey(productId, variantId) {
//     return `${productId}:${variantId || ""}`;
//   }

//   function loadCachedOffer({ productId, variantId, sku, country }) {
//     const key = cacheKey(productId, variantId);
//     if (offerCache.has(key)) return offerCache.get(key);
//     const holder = { requestGeneration: 0 };
//     const pending = requestOffer({ productId, variantId, sku, country }, holder).catch(() => null);
//     offerCache.set(key, pending);
//     return pending;
//   }

//   async function loadForVariant(state, variantId, { keepSelection } = {}) {
//     applyVariantMeta(state, variantId);
//     renderStatus(state, labelFor(state.root, "loadingLabel", "Loading warranty options..."), false);

//     try {
//       const offer = await requestOffer(state, state);
//       if (!offer) return;

//       state.offer = offer;
//       offerCache.set(cacheKey(state.productId, state.variantId), Promise.resolve(offer));

//       if (!offer.eligible || !offer.plans?.length) {
//         state.selectedPlanId = null;
//         if (state.hasRenderedPlans) {
//           renderStatus(state, offerUnavailableMessage(offer, defaultLabels(state.root)), false);
//         } else {
//           state.root.hidden = true;
//           state.root.innerHTML = "";
//         }
//         return;
//       }

//       if (
//         keepSelection &&
//         state.selectedPlanId &&
//         state.selectedPlanId !== NONE_PLAN_ID &&
//         offer.plans.some((plan) => String(plan.planId) === String(state.selectedPlanId))
//       ) {
//         // Keep the customer's explicit choice when the same plan still exists.
//       } else {
//         state.selectedPlanId = defaultPlanId(offer.plans);
//       }

//       state.hasRenderedPlans = true;
//       renderWidget(state);
//       if (
//         sharedModal.el &&
//         !sharedModal.el.hidden &&
//         sharedModal.context?.kind === "pdp" &&
//         sharedModal.context?.widget === state
//       ) {
//         sharedModal.offer = offer;
//         sharedModal.context = {
//           ...sharedModal.context,
//           variantId: state.variantId,
//           productImage: state.productImage,
//           sku: state.sku,
//           offer,
//           selectedPlanId: state.selectedPlanId,
//         };
//         sharedModal.modalPlanId = resolveDraftPlanId(offer.plans, state.selectedPlanId);
//         renderSharedModal();
//       }
//     } catch (err) {
//       ewDebug("[EW PDP] offer failed; product purchase remains available", err);
//       state.offer = null;
//       state.selectedPlanId = null;
//       renderStatus(state, labelFor(state.root, "errorLabel", "Warranty options could not be loaded"), true);
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

//   function normalizeQuantity(value, fallback = 1, { allowZero = false } = {}) {
//     const quantity = Number(value);
//     if (allowZero && quantity === 0) return 0;
//     return Number.isFinite(quantity) && quantity > 0 ? quantity : fallback;
//   }

//   function normalizeVariantId(value) {
//     if (value == null || value === "") return null;
//     const raw = String(value).split("/").pop();
//     const numeric = Number(raw);
//     return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
//   }

//   function propertyMap(item) {
//     const properties = {};
//     const raw = item?.properties;
//     if (Array.isArray(raw)) {
//       for (const entry of raw) {
//         const name = entry?.name || entry?.key;
//         if (name) properties[name] = entry.value;
//       }
//     } else if (raw && typeof raw === "object") {
//       Object.assign(properties, raw);
//     }
//     if (item && typeof item === "object") {
//       for (const [key, value] of Object.entries(item)) {
//         const match = /^properties\[([^\]]+)\]$/.exec(key);
//         if (match) properties[match[1]] = value;
//       }
//     }
//     return properties;
//   }

//   function isWarrantyLine(item) {
//     return propertyMap(item)._ew_type === "extended_warranty";
//   }

//   function isWarrantyCatalogItem(item) {
//     if (isWarrantyLine(item)) return true;
//     const handle = String(item?.handle || "").toLowerCase();
//     if (handle === "sennheiser-extended-warranty") return true;
//     const sku = String(item?.sku || "");
//     if (/^EW-\d+/i.test(sku)) return true;
//     return false;
//   }

//   function collectProperties(item) {
//     return propertyMap(item);
//   }

//   function getParentKey(item) {
//     const rel = item?.parent_relationship;
//     if (rel) {
//       const nested = rel.parent_key || rel.parent?.key || rel.parent_line_key || null;
//       if (nested) return nested;
//     }
//     return propertyMap(item)._ew_parent_key || null;
//   }

//   function lineProductId(item) {
//     const value = item?.product_id ?? item?.product?.id;
//     return value == null || value === "" ? null : String(value);
//   }

//   function lineVariantId(item) {
//     return normalizeVariantId(item?.variant_id ?? item?.id);
//   }

//   /**
//    * A warranty line always carries the product and variant of the line it was
//    * bought for. That identity outranks group ids and line keys, both of which
//    * go stale as soon as Shopify rewrites a line key.
//    */
//   function warrantyMatchesParentProduct(warranty, parent) {
//     const props = propertyMap(warranty);
//     const productId = props._ew_product_id ? String(props._ew_product_id) : null;
//     const variantId = normalizeVariantId(props._ew_variant_id);
//     if (!productId && !variantId) return true;
//     if (variantId && lineVariantId(parent) !== variantId) return false;
//     if (productId) {
//       const parentProduct = lineProductId(parent);
//       if (parentProduct && parentProduct !== productId) return false;
//     }
//     return true;
//   }

//   /**
//    * Assigns every warranty line to exactly one parent product line, so a
//    * warranty can never be counted against two parents (or against the wrong
//    * one) when its group id or parent key no longer resolves.
//    */
//   function buildWarrantyIndex(cart) {
//     const items = cart?.items || [];
//     const parents = items.filter((item) => !isWarrantyLine(item));
//     const parentsByKey = new Map(parents.map((parent) => [parent.key, parent]));
//     const childrenByParent = new Map(parents.map((parent) => [parent.key, []]));
//     const parentByWarranty = new Map();

//     const claim = (parent, warranty) => {
//       childrenByParent.get(parent.key).push(warranty);
//       parentByWarranty.set(warranty.key, parent);
//     };

//     const unresolved = [];
//     for (const warranty of items) {
//       if (!isWarrantyLine(warranty)) continue;
//       const parentKey = getParentKey(warranty);
//       const parent = parentKey ? parentsByKey.get(parentKey) : null;
//       if (parent && warrantyMatchesParentProduct(warranty, parent)) {
//         claim(parent, warranty);
//         continue;
//       }
//       unresolved.push(warranty);
//     }

//     const freeCapacity = (parent) =>
//       Number(parent.quantity || 0) -
//       childrenByParent
//         .get(parent.key)
//         .reduce((sum, child) => sum + Number(child.quantity || 0), 0);

//     const pick = (candidates) =>
//       candidates.find((parent) => freeCapacity(parent) > 0) || candidates[0] || null;

//     for (const warranty of unresolved) {
//       const eligible = parents.filter((parent) => warrantyMatchesParentProduct(warranty, parent));
//       const groupId = propertyMap(warranty)._ew_group_id;
//       const sameGroup = groupId
//         ? eligible.filter((parent) => propertyMap(parent)._ew_group_id === groupId)
//         : [];
//       const parent = pick(sameGroup) || pick(eligible);
//       if (parent) claim(parent, warranty);
//     }

//     return { childrenByParent, parentByWarranty };
//   }

//   const warrantyIndexCache = new WeakMap();

//   function warrantyIndex(cart) {
//     if (!cart || typeof cart !== "object") {
//       return { childrenByParent: new Map(), parentByWarranty: new Map() };
//     }
//     let index = warrantyIndexCache.get(cart);
//     if (!index) {
//       index = buildWarrantyIndex(cart);
//       warrantyIndexCache.set(cart, index);
//     }
//     return index;
//   }

//   function warrantyChildrenOf(cart, parent) {
//     if (!parent?.key) return [];
//     return warrantyIndex(cart).childrenByParent.get(parent.key) || [];
//   }

//   function findWarrantyParent(cart, warranty) {
//     if (!warranty?.key) return null;
//     return warrantyIndex(cart).parentByWarranty.get(warranty.key) || null;
//   }

//   function getRequestItems(body) {
//     if (!body) return [];
//     if (Array.isArray(body)) return body;
//     if (Array.isArray(body.items)) return body.items;
//     if (body.id) return [body];
//     return [];
//   }

//   function toCartLine(item) {
//     const id = normalizeVariantId(item?.id ?? item?.variant_id ?? item?.variantId);
//     if (!id) return null;
//     const line = {
//       id,
//       quantity: normalizeQuantity(item.quantity, 1),
//     };
//     const properties = collectProperties(item);
//     if (Object.keys(properties).length) line.properties = properties;
//     if (item.selling_plan) line.selling_plan = item.selling_plan;
//     return line;
//   }

//   function findParentItem(items, state) {
//     const variantId = Number(state.variantId);
//     return items.find((item) => {
//       const itemVariantId = normalizeVariantId(item?.id ?? item?.variant_id ?? item?.variantId);
//       return itemVariantId === variantId && !isWarrantyLine(item);
//     });
//   }

//   async function fetchWarrantyPayload(context, plan) {
//     const response = await fetch(PROXY_CART, {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json",
//         Accept: "application/json",
//       },
//       body: JSON.stringify({
//         product_id: context.productId,
//         variant_id: context.variantId,
//         plan_id: plan.planId,
//         sku: context.sku || "",
//         country: context.country || "",
//         group_id: context.groupId || "",
//         parent_key: context.parentLineKey || "",
//         source: context.source || "pdp",
//       }),
//     });

//     const payload = await response.json().catch(() => ({}));
//     if (!response.ok || !payload.variantId) {
//       throw new Error(payload.error || "Warranty payload could not be created");
//     }
//     return payload;
//   }

//   function extraCartFields(body) {
//     if (!body || typeof body !== "object" || Array.isArray(body)) return {};
//     const reserved = new Set(["id", "quantity", "items", "form_type", "utf8", "selling_plan"]);
//     const extra = {};
//     for (const [key, value] of Object.entries(body)) {
//       if (reserved.has(key) || /^properties\[/.test(key)) continue;
//       extra[key] = value;
//     }
//     return extra;
//   }

//   function warrantyLinePayload(payload, plan, context, quantity, parentVariantId, groupId) {
//     const warrantyVariantId = normalizeVariantId(payload.variantId);
//     const line = {
//       id: warrantyVariantId,
//       quantity,
//       properties: {
//         ...(payload.properties || {}),
//         _ew_type: "extended_warranty",
//         _ew_source: context.source || "pdp",
//         _ew_plan_id: String(plan.planId),
//         _ew_plan_name: String(plan.planName || payload.planName || ""),
//         _ew_product_id: String(context.productId),
//         _ew_variant_id: String(parentVariantId),
//         _ew_group_id: groupId,
//         ...(context.parentLineKey ? { _ew_parent_key: String(context.parentLineKey) } : {}),
//       },
//     };
//     // Existing cart lines must be referenced by line key. parent_id is a variant id
//     // and Shopify rejects it with 422 once the parent is already in the cart.
//     if (context.parentLineKey) {
//       line.parent_line_key = String(context.parentLineKey);
//     } else if (parentVariantId) {
//       line.parent_id = parentVariantId;
//     }
//     return line;
//   }

//   async function buildNestedCartBody(body) {
//     const sourceItems = getRequestItems(body);
//     if (!sourceItems.length) return null;

//     const nextItems = sourceItems.map((item) => toCartLine(item)).filter(Boolean);
//     if (!nextItems.length) return null;

//     const cart = await readCart();
//     let warrantyAdded = false;

//     for (const state of widgets.values()) {
//       const plan = selectedPlan(state);
//       if (!plan) continue;

//       const parent = findParentItem(nextItems, state);
//       if (!parent) {
//         ewDebug("[EW PDP] No matching product found for warranty state", {
//           variantId: state.variantId,
//           selectedPlanId: state.selectedPlanId,
//         });
//         continue;
//       }

//       const parentVariantId = normalizeVariantId(parent.id ?? state.variantId);
//       const existingParent = (cart?.items || []).find((item) => {
//         if (isWarrantyLine(item)) return false;
//         if (normalizeVariantId(item.variant_id || item.id) !== parentVariantId) return false;
//         if (state.productId && Number(item.product_id) !== Number(state.productId)) return false;
//         return true;
//       });
//       if (existingParent && warrantyChildrenOf(cart, existingParent).length) {
//         ewDebug("[EW PDP] Parent already has a warranty; skipping nested add");
//         continue;
//       }

//       const groupId = createGroupId();
//       const payload = await fetchWarrantyPayload(
//         {
//           productId: state.productId,
//           variantId: parentVariantId,
//           sku: state.sku,
//           country: state.country,
//           groupId,
//           source: "pdp",
//         },
//         plan
//       );
//       const warrantyVariantId = normalizeVariantId(payload.variantId);
//       const productQuantity = normalizeQuantity(parent.quantity, quantityFromContext());

//       if (!parentVariantId) {
//         throw new Error("Could not determine parent variant ID");
//       }
//       if (!warrantyVariantId) {
//         throw new Error("Checkout variant not configured for this plan");
//       }
//       if (warrantyVariantId === parentVariantId) {
//         throw new Error("Checkout variant not configured for this plan");
//       }

//       parent.quantity = productQuantity;
//       parent.properties = {
//         ...(parent.properties || {}),
//         _ew_plan_id: String(plan.planId),
//         _ew_group_id: groupId,
//       };

//       nextItems.push(
//         warrantyLinePayload(
//           payload,
//           plan,
//           {
//             productId: state.productId,
//             source: "pdp",
//           },
//           productQuantity,
//           parentVariantId,
//           groupId
//         )
//       );

//       warrantyAdded = true;
//     }

//     if (!warrantyAdded) return null;

//     return {
//       ...extraCartFields(body),
//       items: nextItems,
//     };
//   }

//   async function parseBodyValue(body, contentType = "") {
//     if (body == null) return null;

//     if (typeof body === "string") {
//       const text = body.trim();
//       if (!text) return null;

//       if (contentType.includes("application/json") || text.startsWith("{") || text.startsWith("[")) {
//         try {
//           const parsed = JSON.parse(text);
//           return Array.isArray(parsed) ? { items: parsed } : parsed;
//         } catch {
//           return null;
//         }
//       }

//       if (contentType.includes("application/x-www-form-urlencoded")) {
//         return parseBodyValue(new URLSearchParams(text), contentType);
//       }

//       return null;
//     }

//     if (typeof FormData !== "undefined" && body instanceof FormData) {
//       const data = {};
//       for (const [key, value] of body.entries()) {
//         if (typeof value === "string") data[key] = value;
//       }
//       return Object.keys(data).length ? data : null;
//     }

//     if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
//       return Object.fromEntries(body.entries());
//     }

//     if (typeof body === "object") return body;
//     return null;
//   }

//   async function parseCartRequest(input, init) {
//     const explicitBody = init?.body;
//     if (explicitBody != null) {
//       const contentType = new Headers(init?.headers || {}).get("content-type") || "";
//       return parseBodyValue(explicitBody, contentType.toLowerCase());
//     }

//     if (typeof Request !== "undefined" && input instanceof Request) {
//       const request = input.clone();
//       const contentType = request.headers.get("content-type") || "";
//       if (contentType.includes("multipart/form-data")) {
//         try {
//           return parseBodyValue(await request.formData(), contentType.toLowerCase());
//         } catch {
//           return null;
//         }
//       }
//       try {
//         return parseBodyValue(await request.text(), contentType.toLowerCase());
//       } catch {
//         return null;
//       }
//     }

//     return null;
//   }

//   function requestUrl(input) {
//     return String(typeof input === "string" ? input : input?.url || "");
//   }

//   function requestMethod(input, init) {
//     if (init?.method) return String(init.method).toUpperCase();
//     if (typeof Request !== "undefined" && input instanceof Request) {
//       return String(input.method || "GET").toUpperCase();
//     }
//     return "GET";
//   }

//   function isCartAddRequest(input, init) {
//     if (requestMethod(input, init) === "GET") return false;
//     return /\/cart\/add(?:\.js)?(?:\?|$)/.test(requestUrl(input));
//   }

//   function isCartMutateRequest(input, init) {
//     if (requestMethod(input, init) === "GET") return false;
//     return /\/cart\/(?:change|update|clear)(?:\.js)?(?:\?|$)/.test(requestUrl(input));
//   }

//   function mergeRequestHeaders(input, init) {
//     const headers = new Headers();
//     if (typeof Request !== "undefined" && input instanceof Request) {
//       input.headers.forEach((value, key) => headers.set(key, value));
//     }
//     if (init?.headers) {
//       new Headers(init.headers).forEach((value, key) => headers.set(key, value));
//     }
//     headers.set("Content-Type", "application/json");
//     headers.set("Accept", "application/json");
//     headers.delete("Content-Length");
//     return headers;
//   }

//   function buildFetchInit(input, init, body) {
//     const nextInit = { ...(init || {}) };
//     if (typeof Request !== "undefined" && input instanceof Request) {
//       nextInit.credentials = nextInit.credentials || input.credentials;
//       nextInit.mode = nextInit.mode || input.mode;
//     }
//     nextInit.method = "POST";
//     nextInit.headers = mergeRequestHeaders(input, init);
//     nextInit.body = JSON.stringify(body);
//     return nextInit;
//   }

//   async function interceptCartAdd(input, init) {
//     const requestBody = await parseCartRequest(input, init);
//     if (!requestBody) return null;

//     const requestItems = getRequestItems(requestBody);
//     if (requestItems.some(isWarrantyLine)) return null;
//     if (![...widgets.values()].some(selectedPlan)) return null;

//     const nestedBody = await buildNestedCartBody(requestBody);
//     if (!nestedBody) return null;
//     return nestedBody;
//   }

//   function warrantyUnitPrice(item) {
//     const qty = Number(item?.quantity) || 1;
//     const candidates = [
//       item?.final_price,
//       item?.price,
//       qty ? Number(item?.final_line_price) / qty : null,
//       qty ? Number(item?.line_price) / qty : null,
//       item?.original_price,
//     ];
//     for (const value of candidates) {
//       const numeric = Number(value);
//       if (Number.isFinite(numeric) && numeric >= 0) return numeric;
//     }
//     return 0;
//   }

//   function sortByLowestWarrantyPrice(items) {
//     return [...items].sort((a, b) => {
//       const diff = warrantyUnitPrice(a) - warrantyUnitPrice(b);
//       if (diff !== 0) return diff;
//       return String(a.key).localeCompare(String(b.key));
//     });
//   }

//   async function setLineQuantity(key, quantity) {
//     if (!nativeFetch || !key) return null;
//     const previous = ewInternal;
//     ewInternal = true;
//     try {
//       const response = await nativeFetch(cartEndpoint("change.js"), {
//         method: "POST",
//         headers: {
//           "Content-Type": "application/json",
//           Accept: "application/json",
//         },
//         body: JSON.stringify({ id: key, quantity }),
//       });
//       if (!response.ok) return null;
//       return response.json();
//     } catch {
//       return null;
//     } finally {
//       ewInternal = previous;
//     }
//   }

//   async function replaceLineProperties(item, properties) {
//     if (!nativeFetch || !item?.key) return null;
//     const previous = ewInternal;
//     ewInternal = true;
//     try {
//       const response = await nativeFetch(cartEndpoint("change.js"), {
//         method: "POST",
//         headers: {
//           "Content-Type": "application/json",
//           Accept: "application/json",
//         },
//         body: JSON.stringify({
//           id: item.key,
//           quantity: item.quantity,
//           properties,
//         }),
//       });
//       if (!response.ok) return null;
//       return response.json();
//     } catch {
//       return null;
//     } finally {
//       ewInternal = previous;
//     }
//   }

//   async function updateLineProperties(item, extra) {
//     return replaceLineProperties(item, { ...propertyMap(item), ...extra });
//   }

//   async function readCart() {
//     if (!nativeFetch) return null;
//     const previous = ewInternal;
//     ewInternal = true;
//     try {
//       const response = await nativeFetch(cartEndpoint("cart.js"), {
//         headers: { Accept: "application/json" },
//       });
//       if (!response.ok) {
//         ewDebug("[EW] Failed to load /cart.js", response.status);
//         return null;
//       }
//       const cart = await response.json();
//       if (!cart || !Array.isArray(cart.items)) return null;
//       return cart;
//     } catch {
//       return null;
//     } finally {
//       ewInternal = previous;
//     }
//   }

//   async function syncChildrenToQuantity(children, targetQty) {
//     const total = children.reduce((sum, child) => sum + Number(child.quantity || 0), 0);
//     if (total === targetQty) return null;

//     let lastCart = null;
//     if (targetQty <= 0) {
//       for (const child of children) {
//         lastCart = (await setLineQuantity(child.key, 0)) || lastCart;
//       }
//       return lastCart;
//     }

//     if (total > targetQty) {
//       let excess = total - targetQty;
//       for (const child of sortByLowestWarrantyPrice(children)) {
//         if (excess <= 0) break;
//         const current = Number(child.quantity || 0);
//         const remove = Math.min(current, excess);
//         lastCart = (await setLineQuantity(child.key, current - remove)) || lastCart;
//         excess -= remove;
//       }
//       return lastCart;
//     }

//     const highest = [...children].sort((a, b) => warrantyUnitPrice(b) - warrantyUnitPrice(a))[0];
//     if (!highest) return null;
//     return setLineQuantity(highest.key, Number(highest.quantity || 0) + (targetQty - total));
//   }

//   async function reconcileCart(cart) {
//     if (!cart?.items || reconciling) return cart;
//     reconciling = true;
//     let current = cart;
//     try {
//       for (let i = 0; i < 20; i += 1) {
//         const items = current.items || [];
//         const orphan = items.find((item) => {
//           if (!isWarrantyLine(item)) return false;
//           return !findWarrantyParent(current, item);
//         });
//         if (!orphan) break;
//         current = (await setLineQuantity(orphan.key, 0)) || current;
//       }

//       const parents = (current.items || []).filter((item) => !isWarrantyLine(item));
//       for (const parent of parents) {
//         const children = warrantyChildrenOf(current, parent);
//         if (!children.length) continue;
//         const next = await syncChildrenToQuantity(children, Number(parent.quantity || 0));
//         if (next) current = next;
//       }
//       return current;
//     } finally {
//       reconciling = false;
//     }
//   }

//   function findCartLine(cart, idOrKey, lineIndex) {
//     const items = cart?.items || [];
//     if (lineIndex != null && lineIndex !== "") {
//       const index = Number(lineIndex) - 1;
//       if (index >= 0 && items[index]) return items[index];
//     }
//     if (idOrKey == null || idOrKey === "") return null;
//     const id = String(idOrKey);
//     return (
//       items.find((item) => item.key === id) ||
//       items.find((item) => String(item.id) === id || String(item.variant_id) === id)
//     );
//   }

//   function mutationChanges(body, cart) {
//     if (!body || !cart) return [];
//     if (body.updates && typeof body.updates === "object") {
//       return Object.entries(body.updates)
//         .map(([id, qty]) => {
//           const item = findCartLine(cart, id);
//           return item
//             ? { item, newQty: normalizeQuantity(qty, 0, { allowZero: true }) }
//             : null;
//         })
//         .filter(Boolean);
//     }

//     const updates = {};
//     for (const [key, value] of Object.entries(body)) {
//       const match = /^updates\[([^\]]+)\]$/.exec(key);
//       if (match) updates[match[1]] = value;
//     }
//     if (Object.keys(updates).length) {
//       return mutationChanges({ updates }, cart);
//     }

//     if (body.id != null || body.line != null) {
//       const item = findCartLine(cart, body.id, body.line);
//       if (!item) return [];
//       return [{ item, newQty: normalizeQuantity(body.quantity, 0, { allowZero: true }) }];
//     }

//     return [];
//   }

//   async function beforeCartMutation(body) {
//     const cart = await readCart();
//     if (!cart) return;
//     const changes = mutationChanges(body, cart);
//     for (const change of changes) {
//       if (isWarrantyLine(change.item)) continue;
//       if (change.newQty >= Number(change.item.quantity || 0)) continue;
//       const children = warrantyChildrenOf(cart, change.item);
//       if (!children.length) continue;
//       await syncChildrenToQuantity(children, change.newQty);
//     }
//   }

//   function cartSectionIds() {
//     const ids = new Set();
//     document.querySelectorAll("cart-items-component[data-section-id], cart-drawer-component[data-section-id], cart-drawer[data-section-id]").forEach((el) => {
//       if (el.dataset.sectionId) ids.add(el.dataset.sectionId);
//     });
//     document.querySelectorAll("[id^='shopify-section-']").forEach((el) => {
//       const id = el.id.replace(/^shopify-section-/, "");
//       if (/cart/i.test(id)) ids.add(id);
//     });
//     return [...ids];
//   }

//   async function refreshCartSections(cart, body) {
//     if (!body?.sections || !nativeFetch) return cart;
//     const previous = ewInternal;
//     ewInternal = true;
//     try {
//       const payload = { updates: {}, sections: body.sections };
//       if (body.sections_url) payload.sections_url = body.sections_url;
//       const response = await nativeFetch(cartEndpoint("update.js"), {
//         method: "POST",
//         headers: {
//           "Content-Type": "application/json",
//           Accept: "application/json",
//         },
//         body: JSON.stringify(payload),
//       });
//       if (response.ok) return response.json();
//     } catch {
//       // Theme sections refresh is best-effort.
//     } finally {
//       ewInternal = previous;
//     }
//     return cart;
//   }

//   async function cartWithSections(cart) {
//     const sections = cartSectionIds();
//     if (!sections.length || !cart) return cart;
//     const withAjax = await refreshCartSections(cart, {
//       sections,
//       sections_url: window.location.pathname,
//     });
//     if (withAjax?.sections && Object.keys(withAjax.sections).length) return withAjax;

//     if (!nativeFetch) return withAjax || cart;
//     const previous = ewInternal;
//     ewInternal = true;
//     try {
//       const params = new URLSearchParams({ sections: sections.join(",") });
//       const response = await nativeFetch(`${window.location.pathname}?${params.toString()}`, {
//         headers: { Accept: "application/json" },
//       });
//       if (!response.ok) return withAjax || cart;
//       const html = await response.json();
//       return { ...cart, sections: html };
//     } catch {
//       return withAjax || cart;
//     } finally {
//       ewInternal = previous;
//     }
//   }

//   function warrantySelectionActive() {
//     return [...widgets.values()].some((state) => Boolean(selectedPlan(state)));
//   }

//   function showWarrantyCartError(message) {
//     const text = message || WARRANTY_CART_ERROR;
//     widgets.forEach((state) => {
//       if (!selectedPlan(state)) return;
//       state.cartError = text;
//       renderWidget(state);
//     });
//   }

//   function clearWarrantyCartErrors() {
//     widgets.forEach((state) => {
//       if (!state.cartError) return;
//       state.cartError = "";
//       renderWidget(state);
//     });
//   }

//   function failedCartResponse(message, sourceResponse) {
//     return new Response(
//       JSON.stringify({
//         status: 422,
//         message,
//         description: message,
//       }),
//       {
//         status: sourceResponse?.status || 422,
//         statusText: sourceResponse?.statusText || "Unprocessable Entity",
//         headers: { "Content-Type": "application/json" },
//       }
//     );
//   }

//   async function logWarrantyCartFailure(response, nestedBody) {
//     if (!isEwDebugEnabled()) return;
//     let bodyText = "";
//     try {
//       bodyText = await response.clone().text();
//     } catch {
//       bodyText = "";
//     }
//     console.error("[EW PDP] Warranty cart add failed", {
//       cartRequestPayload: nestedBody,
//       shopifyResponseStatus: response?.status || null,
//       shopifyResponseBody: bodyText,
//     });
//   }

//   function jsonResponse(data, sourceResponse) {
//     return new Response(JSON.stringify(data), {
//       status: sourceResponse.status,
//       statusText: sourceResponse.statusText,
//       headers: { "Content-Type": "application/json" },
//     });
//   }

//   function notifyCartChanged(cart) {
//     const itemCount = Number(cart?.item_count);
//     const data = {
//       itemCount: Number.isFinite(itemCount) ? itemCount : 0,
//       item_count: Number.isFinite(itemCount) ? itemCount : 0,
//       source: "pdp-extended-warranty",
//     };
//     if (cart?.sections) data.sections = cart.sections;
//     if (cart?.items) data.items = cart.items;
//     const detail = { data, resource: cart || null };
//     const events = [
//       [document, "cart:updated"],
//       [document, "cart:refresh"],
//       [document, "cart:update"],
//       [document.documentElement, "cart:update"],
//     ];
//     for (const [target, type] of events) {
//       try {
//         target.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true, detail }));
//       } catch (err) {
//         ewDebug("[EW cart] Theme cart event failed", err);
//       }
//     }
//     scheduleCartUi();
//   }

//   async function handleMutateResponse(response, requestBody) {
//     if (!response.ok) return response;
//     let cart;
//     try {
//       cart = await response.clone().json();
//     } catch {
//       return response;
//     }
//     if (!cart?.items) return response;
//     const reconciled = await reconcileCart(cart);
//     const withSections = await refreshCartSections(reconciled, requestBody);
//     scheduleCartUi();
//     return jsonResponse(withSections, response);
//   }

//   function installCartHook() {
//     if (cartHookInstalled || !nativeFetch) return;
//     cartHookInstalled = true;

//     window.fetch = async function ewPdpFetch(input, init) {
//       if (ewInternal) return nativeFetch(input, init);

//       if (isCartAddRequest(input, init)) {
//         const wantsWarranty = warrantySelectionActive();
//         try {
//           const nestedBody = await interceptCartAdd(input, init);
//           if (nestedBody) {
//             const url = requestUrl(input);
//             const rewrittenInit = buildFetchInit(input, init, nestedBody);
//             const nestedResponse = await nativeFetch(url, rewrittenInit);
//             if (nestedResponse.ok) {
//               clearWarrantyCartErrors();
//               scheduleCartUi();
//               return nestedResponse;
//             }
//             await logWarrantyCartFailure(nestedResponse, nestedBody);
//             showWarrantyCartError(WARRANTY_CART_ERROR);
//             return nestedResponse;
//           }
//           if (wantsWarranty) {
//             const requestBody = await parseCartRequest(input, init);
//             const items = getRequestItems(requestBody || {});
//             if (!items.some(isWarrantyLine)) {
//               showWarrantyCartError(WARRANTY_CART_ERROR);
//               return failedCartResponse(WARRANTY_CART_ERROR);
//             }
//           }
//         } catch (error) {
//           ewDebug("[EW PDP] Warranty cart preparation failed", error);
//           if (wantsWarranty) {
//             showWarrantyCartError(WARRANTY_CART_ERROR);
//             return failedCartResponse(WARRANTY_CART_ERROR);
//           }
//         }
//         const response = await nativeFetch(input, init);
//         if (response.ok) scheduleCartUi();
//         return response;
//       }

//       if (isCartMutateRequest(input, init)) {
//         const requestBody = await parseCartRequest(input, init);
//         try {
//           await beforeCartMutation(requestBody);
//         } catch (err) {
//           ewDebug("[EW PDP] Pre-change warranty sync failed", err);
//         }
//         const response = await nativeFetch(input, init);
//         try {
//           return await handleMutateResponse(response, requestBody);
//         } catch (err) {
//           ewDebug("[EW PDP] Post-change warranty sync failed", err);
//           return response;
//         }
//       }

//       return nativeFetch(input, init);
//     };

//     if (typeof XMLHttpRequest === "undefined") return;

//     const originalOpen = XMLHttpRequest.prototype.open;
//     const originalSend = XMLHttpRequest.prototype.send;

//     XMLHttpRequest.prototype.open = function ewOpen(method, url, ...rest) {
//       this.__ewMethod = method;
//       this.__ewUrl = url;
//       return originalOpen.call(this, method, url, ...rest);
//     };

//     XMLHttpRequest.prototype.send = function ewSend(body) {
//       if (this.__ewInternal || ewInternal) return originalSend.call(this, body);

//       const fakeInput = { url: String(this.__ewUrl || ""), method: this.__ewMethod || "POST" };
//       const xhr = this;

//       if (isCartMutateRequest(fakeInput, { method: fakeInput.method, body })) {
//         xhr.addEventListener("readystatechange", function ewIntercept(event) {
//           if (xhr.readyState !== 4) return;
//           if (xhr.status < 200 || xhr.status >= 300) return;
//           event.stopImmediatePropagation(); // block theme's listeners from firing with stale data

//           (async () => {
//             let cart;
//             try { cart = JSON.parse(xhr.responseText); } catch { cart = null; }
//             if (cart?.items) {
//               const reconciled = await reconcileCart(cart);
//               const text = JSON.stringify(reconciled);
//               Object.defineProperty(xhr, "responseText", { value: text, configurable: true });
//               Object.defineProperty(xhr, "response", { value: text, configurable: true });
//             }
//             // Re-dispatch so the theme's original listeners now see the corrected cart.
//             xhr.dispatchEvent(new Event("readystatechange"));
//             xhr.dispatchEvent(new Event("load"));
//             scheduleCartUi();
//           })();
//         }, true); // capture phase, so this fires before the theme's own bubble-phase listener

//         parseBodyValue(body, "")
//           .then((requestBody) => beforeCartMutation(requestBody))
//           .catch((err) => ewDebug("[EW PDP] Pre-change warranty sync failed", err))
//           .finally(() => originalSend.call(xhr, body));
//         return;
//       }

//       return originalSend.call(this, body);
//     };
//   }

//   function lineKeySelector(key) {
//     const escaped = quoteAttr(key);
//     return [
//       `[name="${quoteAttr(`updates[${key}]`)}"]`,
//       `[data-cart-item-key="${escaped}"]`,
//       `[data-line-key="${escaped}"]`,
//       `[data-key="${escaped}"]`,
//       `a[href*="${escaped}"]`,
//       `a[href*="${quoteAttr(encodeURIComponent(key))}"]`,
//     ].join(",");
//   }

//   function lineVariantSelector(variantId) {
//     const escaped = quoteAttr(variantId);
//     return [
//       `[data-variant-id="${escaped}"]`,
//       `[data-product-variant-id="${escaped}"]`,
//       `[data-quantity-variant-id="${escaped}"]`,
//     ].join(",");
//   }

//   function rootMatches(root, selector) {
//     return Boolean(root.matches(selector) || root.querySelector(selector));
//   }

//   function closestLineRoot(el) {
//     if (!el) return null;
//     return (
//       el.closest(
//         "[data-cart-item-key], [data-line-key], [data-cart-item], [data-line-item], .cart-item, .cart-drawer-item, .cart-drawer__item, tr.cart-item, [id^='CartDrawer-Item-'], [id^='CartItem-']"
//       ) || el.closest("li, tr, [class*='cart-item'], [class*='cart-line']")
//     );
//   }

//   function productLineRoots() {
//     const selector = [
//       "[data-cart-item]",
//       "[data-line-item]",
//       ".cart-item",
//       ".cart-drawer-item",
//       ".cart-drawer__item",
//       "tr.cart-item",
//       "[id^='CartDrawer-Item-']",
//       "[id^='CartItem-']",
//     ].join(",");
//     return [...document.querySelectorAll(selector)].filter((el) => {
//       if (el.classList.contains("ew-cart-line-hidden")) return false;
//       if (el.closest(".ew-cart-slot, .ew-pdp-modal, .ew-cart-fallback")) return false;
//       return !el.parentElement?.closest(selector);
//     });
//   }

//   /**
//    * Maps every cart line to the row that renders it. Warranty lines take part
//    * in the resolution and each row is claimed once, so a product line can never
//    * inherit the row of a warranty line or of a neighbouring product.
//    */
//   function resolveLineRoots(cart) {
//     const items = cart?.items || [];
//     const roots = productLineRoots();
//     const rootByLineKey = new Map();
//     const claimed = new Set();

//     const claim = (item, root) => {
//       claimed.add(root);
//       rootByLineKey.set(item.key, root);
//     };

//     for (const item of items) {
//       if (!item.key) continue;
//       const selector = lineKeySelector(item.key);
//       const root = roots.find((candidate) => !claimed.has(candidate) && rootMatches(candidate, selector));
//       if (root) claim(item, root);
//     }

//     for (const item of items) {
//       if (!item.key || rootByLineKey.has(item.key)) continue;
//       const variantId = lineVariantId(item);
//       if (!variantId) continue;
//       const selector = lineVariantSelector(variantId);
//       const matches = roots.filter(
//         (candidate) => !claimed.has(candidate) && rootMatches(candidate, selector)
//       );
//       if (matches.length === 1) claim(item, matches[0]);
//     }

//     if (rootByLineKey.size === items.length) return rootByLineKey;

//     // Positional fallback for themes that expose neither line keys nor variant
//     // ids. It only holds when the row count matches one of the two ways a theme
//     // renders nested warranties: a row per cart line, or product rows only with
//     // the warranty drawn inside its parent row.
//     const productItems = items.filter((line) => !isWarrantyCatalogItem(line));
//     const ordered =
//       roots.length === items.length
//         ? items
//         : roots.length === productItems.length
//           ? productItems
//           : null;
//     if (!ordered) return rootByLineKey;

//     ordered.forEach((item, index) => {
//       const root = roots[index];
//       if (!root || claimed.has(root) || rootByLineKey.has(item.key)) return;
//       claim(item, root);
//     });

//     return rootByLineKey;
//   }

//   function cartImage(item) {
//     if (typeof item?.image === "string") return item.image;
//     return item?.featured_image?.url || item?.image || "";
//   }

//   function slotMarkup(item, children) {
//     if (children[0]) return "";
//     return `<button type="button" class="ew-cart-add" data-ew-add-warranty="${escapeHtml(item.key)}" data-ew-product-id="${escapeHtml(item.product_id)}" data-ew-variant-id="${escapeHtml(item.variant_id || item.id)}" data-ew-title="${escapeHtml(item.product_title || item.title || "")}" data-ew-sku="${escapeHtml(item.sku || "")}" data-ew-image="${escapeHtml(cartImage(item))}">Add Warranty</button>`;
//   }

//   async function hydrateCartEligibility(cart) {
//     const parents = (cart.items || []).filter((item) => {
//       if (isWarrantyCatalogItem(item)) return false;
//       return warrantyChildrenOf(cart, item).length === 0;
//     });

//     await Promise.all(
//       parents.map(async (item) => {
//         const offer = await loadCachedOffer({
//           productId: item.product_id,
//           variantId: item.variant_id || item.id,
//           sku: item.sku,
//           country: window.Shopify?.country || "",
//         });
//         if (!offer || (offer.eligible && offer.plans?.length)) return;
//         const slot = document.querySelector(
//           `.ew-cart-slot[data-ew-parent-key="${quoteAttr(item.key)}"]`
//         );
//         if (slot) slot.replaceChildren();
//       })
//     );
//   }

//   function cartFallbackHost() {
//     const items =
//       document.querySelector("cart-items, .cart-items, .cart-drawer__items, [data-cart-items], #CartDrawer-CartItems") ||
//       document.querySelector("cart-drawer form, #CartDrawer form, form[action$='/cart'], form[action*='/cart']") ||
//       document.querySelector("cart-drawer, #CartDrawer, .cart-drawer, [data-cart-drawer]");
//     if (!items) return null;
//     let host = items.querySelector("[data-ew-cart-fallback]");
//     if (!host) {
//       host = document.createElement("div");
//       host.className = "ew-cart-fallback";
//       host.dataset.ewCartFallback = "true";
//       items.appendChild(host);
//     }
//     return host;
//   }

//   function findRemoveElement(container) {
//   return container.querySelector(
//     "a[href*='quantity=0'], a[data-remove], button[data-remove], .cart-item__remove, [class*='remove']"
//   );
// }

//   function upsertSlot(container, item, cart) {
//     const html = slotMarkup(item, warrantyChildrenOf(cart, item));
//     if (container.dataset.ewCartFallback !== "true") {
//       container.querySelectorAll(".ew-cart-slot").forEach((existing) => {
//         if (existing.dataset.ewParentKey !== item.key) existing.remove();
//       });
//     }
//     let slot = container.querySelector(`.ew-cart-slot[data-ew-parent-key="${quoteAttr(item.key)}"]`);
//     if (!html) {
//       if (slot) slot.remove();
//       return;
//     }
//     if (!slot) {
//       slot = document.createElement("div");
//       slot.className = "ew-cart-slot";
//       const removeEl = findRemoveElement(container);
//       if (removeEl) {
//         // Wrap Remove + the warranty button together, in place of Remove,
//         // without altering the layout of anything else in the row.
//         let row = removeEl.closest(".ew-cart-line-row");
//         if (!row) {
//           row = document.createElement("div");
//           row.className = "ew-cart-line-row";
//           removeEl.replaceWith(row);
//           row.appendChild(removeEl);
//         }
//         row.appendChild(slot);
//       } else {
//         container.appendChild(slot);
//       }
//     }
//     slot.dataset.ewParentKey = item.key;
//     if (slot.innerHTML !== html) slot.innerHTML = html;
//     bindSlotActions(slot);
//   }

//   function bindSlotActions(slot) {
//     slot.querySelectorAll("[data-ew-add-warranty]").forEach((btn) => {
//       if (btn.dataset.ewBound === "true") return;
//       btn.dataset.ewBound = "true";
//       btn.addEventListener("click", (event) => {
//         event.preventDefault();
//         event.stopPropagation();
//         openCartWarrantyModal(btn.getAttribute("data-ew-add-warranty"), btn);
//       });
//     });
//     slot.querySelectorAll("[data-ew-remove-warranty]").forEach((btn) => {
//       if (btn.dataset.ewBound === "true") return;
//       btn.dataset.ewBound = "true";
//       btn.addEventListener("click", (event) => {
//         event.preventDefault();
//         event.stopPropagation();
//         removeWarrantyLine(btn.getAttribute("data-ew-remove-warranty"));
//       });
//     });
//   }

//   function renderCartSlots(cart) {
//     const liveKeys = new Set(
//       (cart.items || []).filter((item) => !isWarrantyCatalogItem(item)).map((item) => item.key)
//     );
//     document.querySelectorAll(".ew-cart-slot").forEach((slot) => {
//       if (!liveKeys.has(slot.dataset.ewParentKey)) slot.remove();
//     });

//     document.querySelectorAll(".ew-cart-line-hidden").forEach((el) => {
//       el.classList.remove("ew-cart-line-hidden");
//     });

//     const rootByLineKey = resolveLineRoots(cart);
//     const missing = [];
//     for (const item of cart.items || []) {
//       if (isWarrantyCatalogItem(item)) continue;
//       const root = rootByLineKey.get(item.key);
//       if (!root) {
//         missing.push(item);
//         continue;
//       }
//       upsertSlot(root, item, cart);
//     }

//     const fallback = cartFallbackHost();
//     if (fallback) {
//       if (!missing.length) {
//         if (fallback.innerHTML) fallback.replaceChildren();
//       } else {
//         missing.forEach((item) => upsertSlot(fallback, item, cart));
//       }
//     }
//   }

//   async function refreshCartUi() {
//     if (cartUiRendering) return;
//     cartUiRendering = true;
//     try {
//       const cart = await readCart();
//       if (!cart) return;
//       const reconciled = (await reconcileCart(cart)) || cart;
//       renderCartSlots(reconciled);
//       await hydrateCartEligibility(reconciled);
//     } finally {
//       cartUiRendering = false;
//     }
//   }

//   function scheduleCartUi() {
//     clearTimeout(cartUiTimer);
//     cartUiTimer = setTimeout(() => {
//       refreshCartUi().catch((err) => ewDebug("[EW cart] UI refresh failed", err));
//     }, 80);
//   }

//   async function addWarrantyToLine(parent, plan) {
//     const cart = await readCart();
//     if (!cart) throw new Error("Cart could not be loaded");
//     const current = (cart.items || []).find((item) => item.key === parent.key) || parent;
//     const existing = warrantyChildrenOf(cart, current);
//     if (existing.some((child) => String(propertyMap(child)._ew_plan_id) === String(plan.planId))) {
//       return cart;
//     }

//     for (const child of existing) {
//       await setLineQuantity(child.key, 0);
//     }

//     const initialParent = existing.length
//       ? ((await readCart()) || cart).items.find((item) => item.key === current.key) || current
//       : current;
//     const groupId = propertyMap(initialParent)._ew_group_id || createGroupId();
//     const variantId = normalizeVariantId(initialParent.variant_id || initialParent.id);

//     // Stamp the parent before creating the child. /cart/change.js rewrites the
//     // line key, so doing it afterwards would leave the warranty pointing at a
//     // line that no longer exists.
//     const stamped = await updateLineProperties(initialParent, {
//       _ew_plan_id: String(plan.planId),
//       _ew_group_id: groupId,
//     });
//     const latestParent =
//       (stamped?.items || []).find(
//         (item) =>
//           !isWarrantyLine(item) &&
//           propertyMap(item)._ew_group_id === groupId &&
//           normalizeVariantId(item.variant_id || item.id) === variantId
//       ) || initialParent;

//     const payload = await fetchWarrantyPayload(
//       {
//         productId: latestParent.product_id,
//         variantId,
//         sku: latestParent.sku,
//         country: window.Shopify?.country || "",
//         groupId,
//         parentLineKey: latestParent.key,
//         source: "cart",
//       },
//       plan
//     );

//     const warrantyVariantId = normalizeVariantId(payload.variantId);
//     if (!warrantyVariantId || warrantyVariantId === variantId) {
//       throw new Error("Checkout variant not configured for this plan");
//     }

//     const previous = ewInternal;
//     ewInternal = true;
//     let addedCart;
//     try {
//       const response = await nativeFetch(cartEndpoint("add.js"), {
//         method: "POST",
//         headers: {
//           "Content-Type": "application/json",
//           Accept: "application/json",
//         },
//         body: JSON.stringify({
//           items: [
//             warrantyLinePayload(
//               payload,
//               plan,
//               {
//                 productId: latestParent.product_id,
//                 parentLineKey: latestParent.key,
//                 source: "cart",
//               },
//               latestParent.quantity,
//               variantId,
//               groupId
//             ),
//           ],
//         }),
//       });
//       if (!response.ok) {
//         const errBody = await response.json().catch(() => ({}));
//         throw new Error(errBody.description || errBody.message || "Failed to add warranty");
//       }
//       addedCart = await response.json();
//     } finally {
//       ewInternal = previous;
//     }

//     // Warranty is in the cart now — let the caller (modal) proceed immediately.
//     // Reconciliation, section HTML refresh, and the theme cart-updated event
//     // are UI-refresh concerns, not part of "did the add succeed", so they run
//     // in the background instead of blocking the save button.
//     finalizeWarrantyAdd().catch((err) => ewDebug("[EW cart] background sync failed", err));

//     return addedCart;
//   }

//   async function finalizeWarrantyAdd() {
//     const refreshed = await readCart();
//     if (!refreshed) return;
//     const reconciled = await reconcileCart(refreshed);
//     const withSections = await cartWithSections(reconciled);
//     notifyCartChanged(withSections);
//   }

//   async function removeWarrantyLine(warrantyKey) {
//     const cart = await readCart();
//     if (!cart) return;
//     const warranty = (cart.items || []).find((item) => item.key === warrantyKey);
//     if (!warranty) return;
//     const parent = findWarrantyParent(cart, warranty);
//     const afterRemoval = (await setLineQuantity(warrantyKey, 0)) || cart;
//     const remainingParent = parent
//       ? (afterRemoval.items || []).find((item) => item.key === parent.key)
//       : null;
//     if (remainingParent && !warrantyChildrenOf(afterRemoval, remainingParent).length) {
//       const props = { ...propertyMap(remainingParent) };
//       delete props._ew_plan_id;
//       delete props._ew_group_id;
//       await replaceLineProperties(remainingParent, props);
//     }
//     const refreshed = await readCart();
//     const reconciled = await reconcileCart(refreshed || cart);
//     const withSections = await cartWithSections(reconciled);
//     notifyCartChanged(withSections);
//   }

//   function openCartWarrantyModal(parentKey, fromEl) {
//     const productId = fromEl?.getAttribute("data-ew-product-id");
//     const variantId = normalizeVariantId(fromEl?.getAttribute("data-ew-variant-id"));
//     if (parentKey && productId && variantId) {
//       openSharedModal({
//         kind: "cart",
//         productId,
//         variantId,
//         productTitle: fromEl.getAttribute("data-ew-title") || "",
//         productImage: fromEl.getAttribute("data-ew-image") || "",
//         sku: fromEl.getAttribute("data-ew-sku") || "",
//         country: window.Shopify?.country || "",
//         parentLineKey: parentKey,
//         selectedPlanId: null,
//       });
//       return;
//     }

//     readCart().then((cart) => {
//       const parent = (cart?.items || []).find((item) => item.key === parentKey);
//       if (!parent || isWarrantyCatalogItem(parent)) return;
//       openSharedModal({
//         kind: "cart",
//         productId: parent.product_id,
//         variantId: normalizeVariantId(parent.variant_id || parent.id),
//         productTitle: parent.product_title || parent.title || "",
//         productImage: cartImage(parent),
//         sku: parent.sku || "",
//         country: window.Shopify?.country || "",
//         parentLineKey: parent.key,
//         quantity: parent.quantity,
//         selectedPlanId: propertyMap(parent)._ew_plan_id || null,
//         parent,
//       });
//     });
//   }

//   async function saveSharedModal() {
//     const context = sharedModal.context;
//     if (!context) return;
//     const nextId = sharedModal.modalPlanId;

//     if (context.kind === "pdp" && context.widget) {
//       context.widget.selectedPlanId = nextId === NONE_PLAN_ID ? null : nextId;
//       context.widget.cartError = "";
//       renderWidget(context.widget);
//       closeSharedModal();
//       return;
//     }

//     if (context.kind === "cart") {
//       if (nextId === NONE_PLAN_ID || !nextId) {
//         closeSharedModal();
//         return;
//       }
//       const plan = (sharedModal.offer?.plans || []).find(
//         (item) => String(item.planId) === String(nextId)
//       );
//       if (!plan || !context.parentLineKey) {
//         closeSharedModal();
//         return;
//       }
//       sharedModal.saving = true;
//       renderSharedModal();
//       try {
//         const cart = await readCart();
//         const parent = (cart?.items || []).find((item) => item.key === context.parentLineKey);
//         if (!parent) throw new Error("Cart line not found");
//         await addWarrantyToLine(parent, plan);
//         closeSharedModal();
//       } catch (err) {
//         ewDebug("[EW cart] Failed to add warranty", err);
//         sharedModal.saving = false;
//         const right = sharedModal.el?.querySelector(".ew-pdp-modal__right");
//         if (right) {
//           const status = document.createElement("p");
//           status.className = "ew-pdp__status is-error";
//           status.textContent = WARRANTY_CART_ERROR;
//           right.appendChild(status);
//         }
//       }
//     }
//   }

//   function onSharedModalClick(event) {
//     if (closestFromEvent(event, "[data-ew-close-modal]")) {
//       closeSharedModal();
//       return;
//     }
//     const planButton = closestFromEvent(event, "[data-ew-modal-plan]");
//     if (planButton) {
//       sharedModal.modalPlanId = planButton.getAttribute("data-ew-modal-plan");
//       renderSharedModal();
//       return;
//     }
//     if (closestFromEvent(event, "[data-ew-save]")) {
//       saveSharedModal();
//     }
//   }

//   function onRootClick(state, event) {
//     const planButton = event.target.closest("[data-ew-plan-id]");
//     if (planButton) {
//       const id = planButton.getAttribute("data-ew-plan-id");
//       state.selectedPlanId = String(state.selectedPlanId) === String(id) ? null : id;
//       state.cartError = "";
//       renderWidget(state);
//       return;
//     }
//     if (event.target.closest("[data-ew-open-modal]")) {
//       openPdpModal(state);
//     }
//   }

//   function onDocumentClick(event) {
//     const addBtn = closestFromEvent(event, "[data-ew-add-warranty]");
//     if (addBtn) {
//       event.preventDefault();
//       event.stopPropagation();
//       openCartWarrantyModal(addBtn.getAttribute("data-ew-add-warranty"), addBtn);
//       return;
//     }
//     const removeBtn = closestFromEvent(event, "[data-ew-remove-warranty]");
//     if (removeBtn) {
//       event.preventDefault();
//       event.stopPropagation();
//       removeWarrantyLine(removeBtn.getAttribute("data-ew-remove-warranty"));
//     }
//   }

//   function notifyVariantChange(variantId) {
//     const nextId = Number(variantId);
//     if (!nextId) return;
//     widgets.forEach((state) => {
//       const belongs = state.variants.some((item) => Number(item.id) === nextId);
//       if (!belongs && Number(state.variantId) !== nextId) return;
//       if (nextId === Number(state.variantId)) return;
//       loadForVariant(state, nextId, { keepSelection: true });
//     });
//   }

//   function installVariantWatch() {
//     if (variantWatchInstalled) return;
//     variantWatchInstalled = true;

//     document.addEventListener("variant:update", (event) => {
//       const id =
//         event.detail?.variant?.id || event.detail?.data?.variant?.id || event.detail?.id;
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

//   function initCartUi() {
//     if (cartUiInstalled) return;
//     cartUiInstalled = true;

//     document.addEventListener("click", onDocumentClick, true);
//     document.addEventListener("cart:updated", scheduleCartUi);
//     document.addEventListener("cart:refresh", scheduleCartUi);
//     document.addEventListener("cart:open", scheduleCartUi);
//     document.addEventListener("cart:update", scheduleCartUi);

//     const observer = new MutationObserver((mutations) => {
//       if (ewInternal || cartUiRendering) return;
//       const relevant = mutations.some((mutation) => {
//         const target = mutation.target;
//         if (!(target instanceof Element)) return mutation.addedNodes.length > 0;
//         if (target.closest(".ew-cart-slot, .ew-pdp-modal")) return false;
//         return true;
//       });
//       if (relevant) scheduleCartUi();
//     });
//     observer.observe(document.body, { childList: true, subtree: true });
//     scheduleCartUi();
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
//       providerName: root.dataset.providerName || "",
//       providerLogo: root.dataset.providerLogo || "",
//       shopName: root.dataset.shopName || "",
//       variants: parseVariants(root),
//       offer: null,
//       selectedPlanId: null,
//       requestGeneration: 0,
//       hasRenderedPlans: false,
//     };

//     widgets.set(root.dataset.blockId, state);
//     root.addEventListener("click", (event) => onRootClick(state, event));
//     installVariantWatch();
//     installCartHook();
//     loadForVariant(state, resolveCurrentVariantId(state));
//   }

//   function initAll() {
//     installCartHook();
//     initCartUi();
//     document.querySelectorAll("[data-ew-pdp-root]").forEach(initWidget);
//   }

//   document.addEventListener("keydown", (event) => {
//     if (event.key === "Escape") closeSharedModal();
//   });

//   if (document.readyState === "loading") {
//     document.addEventListener("DOMContentLoaded", initAll);
//   } else {
//     initAll();
//   }

//   document.addEventListener("shopify:section:load", initAll);
//   document.addEventListener("shopify:section:reorder", initAll);
// })();


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
  const offerResults = new Map();
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

  function getConfiguredCartType() {
    const config =
      document.getElementById("ew-cart-config") ||
      document.querySelector("[data-ew-cart-type]");
    const type = String(config?.dataset?.ewCartType || "").trim().toLowerCase();
    return (type === "drawer" || type === "page" || type === "popup") ? type : null;
  }

  function isCartPage() {
    const cartPath = window.Shopify?.routes?.cart || "/cart";
    try {
      const currentPath = window.location.pathname.replace(/\/+$/, "") || "/";
      const expectedPath = new URL(cartPath, window.location.origin).pathname.replace(/\/+$/, "") || "/";
      return currentPath === expectedPath;
    } catch {
      return window.location.pathname === "/cart";
    }
  }

  function getCartDisplayMode(container) {
  if (!container) return "page";

  // First detect the actual DOM.
  // This is more reliable than the configured setting because
  // the same page can contain a cart drawer and a cart page.
  if (isCartDrawerContainer(container)) {
    return "drawer";
  }

  if (isCartPage()) {
    return "page";
  }

  // Only use the setting when the DOM cannot identify the cart.
  const configuredType = getConfiguredCartType();

  if (configuredType === "drawer") return "drawer";
  if (configuredType === "page" || configuredType === "popup") return "page";

  return "page";
}

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
    const retry = isError
      ? `<button type="button" class="ew-pdp__covered-link" data-ew-retry>Try again</button>`
      : "";
    state.root.innerHTML = `<p class="ew-pdp__status${isError ? " is-error" : ""}">${escapeHtml(message)}</p>${retry}`;
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
        ${showCovered
        ? `<button type="button" class="ew-pdp__covered-link" data-ew-open-modal>${escapeHtml(coveredLabel)}</button>`
        : ""
      }
        ${providerMarkup(state, "ew-pdp__brand")}
      </div>
      <div class="ew-pdp__plans">${cards}</div>
      ${state.cartError
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
          ${labels.shopLogo
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
      rightHtml = `<p class="ew-pdp__status is-error">${escapeHtml(labels.errorLabel)}</p><button type="button" class="ew-pdp-modal__save" data-ew-retry-modal>Try again</button>`;
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
      ${termsUrl
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

    if (sharedModal.offer && !sharedModal.offer.error) return;

    try {
      const offer = await loadCachedOffer(context);
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

  // Reloads plans after a failed offer request without leaving the modal.
  async function retrySharedModal() {
    const context = sharedModal.context;
    if (!context) return;
    clearCachedOffer(context.productId, context.variantId);
    sharedModal.offer = null;
    sharedModal.saving = false;
    renderSharedModal();
    try {
      const offer = await loadCachedOffer(context);
      if (!offer || sharedModal.context !== context) return;
      sharedModal.offer = offer;
      if (context.widget) context.widget.offer = offer;
      sharedModal.modalPlanId = resolveDraftPlanId(offer?.plans, context.selectedPlanId);
      renderSharedModal();
    } catch {
      if (sharedModal.context !== context) return;
      sharedModal.offer = { eligible: false, error: true };
      renderSharedModal();
    }
  }

  function openPdpModal(state) {
    openSharedModal({
      kind: "pdp",
      widget: state,
      productId: state.productId,
      variantId: state.variantId,
      productTitle: state.productTitle,
      productImage: state.productImage,
      sku: state.sku,
      country: state.country,
      offer: state.offer || peekCachedOffer(state.productId, state.variantId),
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

  // Returns a plan list that has already finished loading for this variant.
  function peekCachedOffer(productId, variantId) {
    return offerResults.get(cacheKey(productId, variantId)) || null;
  }

  // Drops a cached plan list so the next open can try the warranty API again.
  function clearCachedOffer(productId, variantId) {
    const key = cacheKey(productId, variantId);
    offerCache.delete(key);
    offerResults.delete(key);
  }

  // Loads warranty plans once per product variant and reuses that request.
  function loadCachedOffer({ productId, variantId, sku, country }) {
    const key = cacheKey(productId, variantId);
    if (offerCache.has(key)) return offerCache.get(key);
    const holder = { requestGeneration: 0 };
    const pending = requestOffer({ productId, variantId, sku, country }, holder)
      .then((offer) => {
        if (offerCache.get(key) !== pending) return offer;
        if (offer) offerResults.set(key, offer);
        else offerCache.delete(key);
        return offer;
      })
      .catch((err) => {
        if (offerCache.get(key) === pending) {
          offerCache.delete(key);
          offerResults.delete(key);
        }
        throw err;
      });
    offerCache.set(key, pending);
    return pending;
  }

  async function loadForVariant(state, variantId, { keepSelection } = {}) {
    const generation = ++state.requestGeneration;
    applyVariantMeta(state, variantId);
    renderStatus(state, labelFor(state.root, "loadingLabel", "Loading warranty options..."), false);

    try {
      const offer = await loadCachedOffer(state);
      if (generation !== state.requestGeneration || !offer) return;

      state.offer = offer;

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

  function lineProductId(item) {
    const value = item?.product_id ?? item?.product?.id;
    return value == null || value === "" ? null : String(value);
  }

  function lineVariantId(item) {
    return normalizeVariantId(item?.variant_id ?? item?.id);
  }

  /**
   * A warranty line always carries the product and variant of the line it was
   * bought for. That identity outranks group ids and line keys, both of which
   * go stale as soon as Shopify rewrites a line key.
   */
  function warrantyMatchesParentProduct(warranty, parent) {
    const props = propertyMap(warranty);
    const productId = props._ew_product_id ? String(props._ew_product_id) : null;
    const variantId = normalizeVariantId(props._ew_variant_id);
    if (!productId && !variantId) return true;
    if (variantId && lineVariantId(parent) !== variantId) return false;
    if (productId) {
      const parentProduct = lineProductId(parent);
      if (parentProduct && parentProduct !== productId) return false;
    }
    return true;
  }

  /**
   * Assigns every warranty line to exactly one parent product line, so a
   * warranty can never be counted against two parents (or against the wrong
   * one) when its group id or parent key no longer resolves.
   */
  function buildWarrantyIndex(cart) {
    const items = cart?.items || [];
    const parents = items.filter((item) => !isWarrantyLine(item));
    const parentsByKey = new Map(parents.map((parent) => [parent.key, parent]));
    const childrenByParent = new Map(parents.map((parent) => [parent.key, []]));
    const parentByWarranty = new Map();

    const claim = (parent, warranty) => {
      childrenByParent.get(parent.key).push(warranty);
      parentByWarranty.set(warranty.key, parent);
    };

    const unresolved = [];
    for (const warranty of items) {
      if (!isWarrantyLine(warranty)) continue;
      const parentKey = getParentKey(warranty);
      const parent = parentKey ? parentsByKey.get(parentKey) : null;
      if (parent && warrantyMatchesParentProduct(warranty, parent)) {
        claim(parent, warranty);
        continue;
      }
      unresolved.push(warranty);
    }

    const freeCapacity = (parent) =>
      Number(parent.quantity || 0) -
      childrenByParent
        .get(parent.key)
        .reduce((sum, child) => sum + Number(child.quantity || 0), 0);

    const pick = (candidates) =>
      candidates.find((parent) => freeCapacity(parent) > 0) || candidates[0] || null;

    for (const warranty of unresolved) {
      const eligible = parents.filter((parent) => warrantyMatchesParentProduct(warranty, parent));
      const groupId = propertyMap(warranty)._ew_group_id;
      const sameGroup = groupId
        ? eligible.filter((parent) => propertyMap(parent)._ew_group_id === groupId)
        : [];
      const parent = pick(sameGroup) || pick(eligible);
      if (parent) claim(parent, warranty);
    }

    return { childrenByParent, parentByWarranty };
  }

  const warrantyIndexCache = new WeakMap();

  function warrantyIndex(cart) {
    if (!cart || typeof cart !== "object") {
      return { childrenByParent: new Map(), parentByWarranty: new Map() };
    }
    let index = warrantyIndexCache.get(cart);
    if (!index) {
      index = buildWarrantyIndex(cart);
      warrantyIndexCache.set(cart, index);
    }
    return index;
  }

  function warrantyChildrenOf(cart, parent) {
    if (!parent?.key) return [];
    return warrantyIndex(cart).childrenByParent.get(parent.key) || [];
  }

  function findWarrantyParent(cart, warranty) {
    if (!warranty?.key) return null;
    return warrantyIndex(cart).parentByWarranty.get(warranty.key) || null;
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

  // Prefers the cart line that already has warranty so a repeat add does not create another product line.
  function findExistingParentLine(cart, variantId, productId) {
    const matches = (cart?.items || []).filter((item) => {
      if (isWarrantyLine(item) || isWarrantyCatalogItem(item)) return false;
      if (normalizeVariantId(item.variant_id || item.id) !== variantId) return false;
      if (productId && lineProductId(item) && String(lineProductId(item)) !== String(productId)) return false;
      return true;
    });
    if (!matches.length) return null;
    return matches.find((item) => warrantyChildrenOf(cart, item).length > 0) || matches[0];
  }

  // Copies the existing line properties so Shopify increases quantity instead of adding a second line.
  async function alignAddWithExistingLines(body) {
    const sourceItems = getRequestItems(body);
    if (!sourceItems.length) return null;
    const cart = await readCart();
    if (!cart?.items?.length) return null;

    const nextItems = [];
    let aligned = false;
    for (const item of sourceItems) {
      const line = toCartLine(item);
      if (!line) continue;
      const existing = findExistingParentLine(cart, line.id, item.product_id || item.productId);
      if (existing) {
        const existingProps = propertyMap(existing);
        if (Object.keys(existingProps).length) {
          line.properties = { ...(line.properties || {}), ...existingProps };
          aligned = true;
        }
      }
      nextItems.push(line);
    }
    if (!aligned) return null;
    return {
      ...extraCartFields(body),
      items: nextItems,
    };
  }

  async function buildNestedCartBody(body) {
    const sourceItems = getRequestItems(body);
    if (!sourceItems.length) return null;

    const nextItems = sourceItems.map((item) => toCartLine(item)).filter(Boolean);
    if (!nextItems.length) return null;

    const cart = await readCart();
    let warrantyAdded = false;
    let merged = false;
    let warrantyFailed = false;

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
      if (!parentVariantId) {
        throw new Error("Could not determine parent variant ID");
      }

      const existingParent = findExistingParentLine(cart, parentVariantId, state.productId);
      if (existingParent) {
        const existingProps = propertyMap(existingParent);
        if (Object.keys(existingProps).length) {
          parent.properties = { ...(parent.properties || {}), ...existingProps };
        }
        merged = true;
        if (warrantyChildrenOf(cart, existingParent).length) {
          ewDebug("[EW PDP] Parent already has a warranty; increasing product quantity only");
          continue;
        }

        try {
          const groupId = existingProps._ew_group_id || createGroupId();
          const payload = await fetchWarrantyPayload(
            {
              productId: state.productId,
              variantId: parentVariantId,
              sku: state.sku,
              country: state.country,
              groupId,
              parentLineKey: existingParent.key,
              source: "pdp",
            },
            plan
          );
          const warrantyVariantId = normalizeVariantId(payload.variantId);
          if (!warrantyVariantId || warrantyVariantId === parentVariantId) {
            throw new Error("Checkout variant not configured for this plan");
          }
          nextItems.push(
            warrantyLinePayload(
              payload,
              plan,
              {
                productId: state.productId,
                parentLineKey: existingParent.key,
                source: "pdp",
              },
              normalizeQuantity(parent.quantity, quantityFromContext()),
              parentVariantId,
              groupId
            )
          );
          warrantyAdded = true;
        } catch (err) {
          warrantyFailed = true;
          ewDebug("[EW PDP] Warranty add failed; product quantity will still update", err);
        }
        continue;
      }

      const groupId = createGroupId();
      let payload;
      try {
        payload = await fetchWarrantyPayload(
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
      } catch (err) {
        warrantyFailed = true;
        ewDebug("[EW PDP] Warranty add failed; product can still be added", err);
        continue;
      }

      const warrantyVariantId = normalizeVariantId(payload.variantId);
      const productQuantity = normalizeQuantity(parent.quantity, quantityFromContext());
      if (!warrantyVariantId || warrantyVariantId === parentVariantId) {
        warrantyFailed = true;
        continue;
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

    if (!warrantyAdded && !merged && !warrantyFailed) return null;

    return {
      ...extraCartFields(body),
      items: nextItems,
      ...(warrantyFailed ? { warrantyWarning: true } : {}),
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
    if (!requestItems.length || requestItems.some(isWarrantyLine)) return null;
    if ([...widgets.values()].some(selectedPlan)) {
      return buildNestedCartBody(requestBody);
    }
    return alignAddWithExistingLines(requestBody);
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
        const next = await capChildrenToParent(children, Number(parent.quantity || 0));
        if (next) current = next;
      }
      return current;
    } finally {
      reconciling = false;
    }
  }

  // Lowers warranty quantity only when it is above the product quantity.
  async function capChildrenToParent(children, parentQty) {
    const total = children.reduce((sum, child) => sum + Number(child.quantity || 0), 0);
    if (total <= parentQty) return null;
    return syncChildrenToQuantity(children, parentQty);
  }

  // Finds a cart line by key, then by a unique variant id. Line index is only a last resort.
  function findCartLine(cart, idOrKey, lineIndex) {
    const items = cart?.items || [];
    if (idOrKey != null && idOrKey !== "") {
      const id = String(idOrKey);
      const byKey = items.find((item) => item.key === id);
      if (byKey) return byKey;
      const byVariant = items.filter(
        (item) => String(item.variant_id) === id || String(item.id) === id
      );
      if (byVariant.length === 1) return byVariant[0];
      if (byVariant.length > 1 && lineIndex != null && lineIndex !== "") {
        const at = items[Number(lineIndex) - 1];
        if (at && byVariant.includes(at)) return at;
      }
      return null;
    }
    if (lineIndex != null && lineIndex !== "") {
      const index = Number(lineIndex) - 1;
      return index >= 0 ? items[index] || null : null;
    }
    return null;
  }

  function mutationChanges(body, cart) {
    if (!body || !cart) return [];
    if (body.updates && typeof body.updates === "object" && !Array.isArray(body.updates)) {
      return Object.entries(body.updates).map(([id, qty]) => {
        const item = findCartLine(cart, id);
        const newQty = normalizeQuantity(qty, 0, { allowZero: true });
        return item ? { item, newQty } : { unresolvedId: id, newQty };
      });
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
      const newQty = normalizeQuantity(body.quantity, 0, { allowZero: true });
      return item ? [{ item, newQty }] : [];
    }

    return [];
  }

  // Rewrites a cart change onto line keys so later warranty edits cannot shift the target.
  function rewriteMutationBody(body, changes) {
    if (!body) return body;
    const hasUpdates =
      (body.updates && typeof body.updates === "object" && !Array.isArray(body.updates)) ||
      Object.keys(body).some((key) => /^updates\[/.test(key));
    if (hasUpdates) {
      const updates = {};
      for (const change of changes) {
        if (change.item) updates[change.item.key] = change.newQty;
        else if (change.unresolvedId != null) updates[change.unresolvedId] = change.newQty;
      }
      const next = { ...body };
      for (const key of Object.keys(next)) {
        if (/^updates\[/.test(key)) delete next[key];
      }
      next.updates = updates;
      return next;
    }

    const change = changes.find((entry) => entry.item);
    if (!change) return body;
    const next = { ...body, id: change.item.key, quantity: change.newQty };
    delete next.line;
    return next;
  }

  // Keeps warranty quantity at or below the product quantity after this cart change.
  function capWarrantyQuantities(changes, cart) {
    const pending = [];
    const byKey = new Map(
      changes.filter((change) => change.item).map((change) => [change.item.key, change])
    );
    const parents = new Set();
    for (const change of changes) {
      if (!change.item) continue;
      if (isWarrantyLine(change.item)) {
        const parent = findWarrantyParent(cart, change.item);
        if (parent) parents.add(parent);
      } else {
        parents.add(change.item);
      }
    }

    for (const parent of parents) {
      const children = warrantyChildrenOf(cart, parent);
      if (!children.length) continue;
      const parentChange = byKey.get(parent.key);
      const parentQty = parentChange ? parentChange.newQty : Number(parent.quantity || 0);
      const rows = children.map((child) => {
        const change = byKey.get(child.key);
        return {
          child,
          change,
          qty: change ? change.newQty : Number(child.quantity || 0),
        };
      });
      let excess = rows.reduce((sum, row) => sum + row.qty, 0) - parentQty;
      if (excess <= 0) continue;
      for (const child of sortByLowestWarrantyPrice(rows.map((row) => row.child))) {
        if (excess <= 0) break;
        const row = rows.find((entry) => entry.child.key === child.key);
        const remove = Math.min(row.qty, excess);
        if (remove <= 0) continue;
        row.qty -= remove;
        excess -= remove;
        if (row.change) row.change.newQty = row.qty;
        else pending.push({ key: child.key, quantity: row.qty });
      }
    }
    return pending;
  }

  // Applies warranty caps and returns the cart request identified by line keys.
  async function prepareCartMutation(body) {
    if (!body) return null;
    const cart = await readCart();
    if (!cart) return null;
    const changes = mutationChanges(body, cart);
    if (!changes.some((change) => change.item)) return null;
    const pending = capWarrantyQuantities(changes, cart);
    for (const step of pending) {
      await setLineQuantity(step.key, step.quantity);
    }
    return { body: rewriteMutationBody(body, changes) };
  }

  // Preserves the original cart request encoding when a quantity change is rewritten.
  function encodeCartBody(original, nextBody) {
    const asParams = () => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(nextBody)) {
        if (value == null) continue;
        if (key === "updates" && value && typeof value === "object") {
          for (const [id, qty] of Object.entries(value)) params.set(`updates[${id}]`, String(qty));
          continue;
        }
        params.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
      }
      return params;
    };

    if (typeof URLSearchParams !== "undefined" && original instanceof URLSearchParams) {
      return asParams();
    }
    if (typeof FormData !== "undefined" && original instanceof FormData) {
      const data = new FormData();
      asParams().forEach((value, key) => data.append(key, value));
      return data;
    }
    if (typeof original === "string") {
      const text = original.trim();
      if (!text.startsWith("{") && !text.startsWith("[")) return asParams().toString();
    }
    return JSON.stringify(nextBody);
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
            const warrantyWarning = Boolean(nestedBody.warrantyWarning);
            delete nestedBody.warrantyWarning;
            const url = requestUrl(input);
            const rewrittenInit = buildFetchInit(input, init, nestedBody);
            const nestedResponse = await nativeFetch(url, rewrittenInit);
            if (nestedResponse.ok) {
              clearWarrantyCartErrors();
              if (warrantyWarning) showWarrantyCartError(WARRANTY_CART_ERROR);
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
        let requestBody = null;
        let outboundInput = input;
        let outboundInit = init;
        try {
          requestBody = await parseCartRequest(input, init);
          const prepared = await prepareCartMutation(requestBody);
          if (prepared?.body) {
            requestBody = prepared.body;
            outboundInput = requestUrl(input);
            outboundInit = buildFetchInit(input, init, prepared.body);
          }
        } catch (err) {
          ewDebug("[EW PDP] Pre-change warranty sync failed", err);
        }
        const response = await nativeFetch(outboundInput, outboundInit);
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
      if (this.__ewInternal || ewInternal) return originalSend.call(this, body);

      const fakeInput = { url: String(this.__ewUrl || ""), method: this.__ewMethod || "POST" };
      const xhr = this;

      // Themes that add to cart via XHR bypass the fetch hook that nests the
      // warranty. Let the product add proceed, then attach the selected warranty
      // through the reliable cart flow so both land without a page refresh.
      if (isCartAddRequest(fakeInput, { method: fakeInput.method, body })) {
        if (warrantySelectionActive()) {
          xhr.addEventListener("load", function ewAddDone() {
            if (xhr.status >= 200 && xhr.status < 300) {
              attachSelectedWarrantiesAfterAdd().catch((err) =>
                ewDebug("[EW PDP] Post-add warranty attach failed", err)
              );
            }
          });
        }
        return originalSend.call(this, body);
      }

      if (isCartMutateRequest(fakeInput, { method: fakeInput.method, body })) {
        xhr.addEventListener("readystatechange", function ewIntercept(event) {
          if (xhr.readyState !== 4) return;
          if (xhr.status < 200 || xhr.status >= 300) return;
          event.stopImmediatePropagation(); // block theme's listeners from firing with stale data

          (async () => {
            let cart;
            try { cart = JSON.parse(xhr.responseText); } catch { cart = null; }
            if (cart?.items) {
              const reconciled = await reconcileCart(cart);
              const text = JSON.stringify(reconciled);
              Object.defineProperty(xhr, "responseText", { value: text, configurable: true });
              Object.defineProperty(xhr, "response", { value: text, configurable: true });
            }
            // Re-dispatch so the theme's original listeners now see the corrected cart.
            xhr.dispatchEvent(new Event("readystatechange"));
            xhr.dispatchEvent(new Event("load"));
            scheduleCartUi();
          })();
        }, true); // capture phase, so this fires before the theme's own bubble-phase listener

        parseBodyValue(body, "")
          .then((requestBody) => prepareCartMutation(requestBody))
          .then((prepared) => {
            const nextBody = prepared?.body ? encodeCartBody(body, prepared.body) : body;
            originalSend.call(xhr, nextBody);
          })
          .catch((err) => {
            ewDebug("[EW PDP] Pre-change warranty sync failed", err);
            originalSend.call(xhr, body);
          });
        return;
      }

      return originalSend.call(this, body);
    };
  }

  function lineKeySelector(key) {
  const escaped = quoteAttr(key);

  return [
    `[data-line-item-line-key="${escaped}"]`,
    `[data-line-item-key="${escaped}"]`,
    `[name="${quoteAttr(`updates[${key}]`)}"]`,
    `[data-cart-item-key="${escaped}"]`,
    `[data-line-key="${escaped}"]`,
    `[data-key="${escaped}"]`,
    `a[href*="${escaped}"]`,
    `a[href*="${quoteAttr(encodeURIComponent(key))}"]`,
  ].join(",");
}

  function lineVariantSelector(variantId) {
    const escaped = quoteAttr(variantId);
    return [
      `[data-variant-id="${escaped}"]`,
      `[data-product-variant-id="${escaped}"]`,
      `[data-quantity-variant-id="${escaped}"]`,
    ].join(",");
  }

  function rootMatches(root, selector) {
    return Boolean(root.matches(selector) || root.querySelector(selector));
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
    /*
     * Sennheiser theme
     */
    ".product-row[data-line-item-line-key]",
    ".product-row[data-line-item-key]",
    "[data-line-item-line-key]",
    "[data-line-item-key]",

    /*
     * Existing theme selectors
     */
    "[data-cart-item]",
    "[data-line-item]",
    ".cart-item",
    ".cart-drawer-item",
    ".cart-drawer__item",
    "tr.cart-item",
    "[id^='CartDrawer-Item-']",
    "[id^='CartItem-']"
  ].join(",");

  return [...document.querySelectorAll(selector)].filter((el) => {
    if (el.classList.contains("ew-cart-line-hidden")) return false;

    if (
      el.closest(
        ".ew-cart-slot, .ew-pdp-modal, .ew-cart-fallback"
      )
    ) {
      return false;
    }

    return !el.parentElement?.closest(selector);
  });
}

  /**
   * Maps every cart line to the row that renders it. Warranty lines take part
   * in the resolution and each row is claimed once, so a product line can never
   * inherit the row of a warranty line or of a neighbouring product.
   */
  function resolveLineRoots(cart) {
    const items = cart?.items || [];
    const roots = productLineRoots();
    const rootByLineKey = new Map();
    const claimed = new Set();

    const claim = (item, root) => {
      claimed.add(root);
      rootByLineKey.set(item.key, root);
    };

    for (const item of items) {
      if (!item.key) continue;
      const selector = lineKeySelector(item.key);
      const root = roots.find((candidate) => !claimed.has(candidate) && rootMatches(candidate, selector));
      if (root) claim(item, root);
    }

    for (const item of items) {
      if (!item.key || rootByLineKey.has(item.key)) continue;
      const variantId = lineVariantId(item);
      if (!variantId) continue;
      const selector = lineVariantSelector(variantId);
      const matches = roots.filter(
        (candidate) => !claimed.has(candidate) && rootMatches(candidate, selector)
      );
      if (matches.length === 1) claim(item, matches[0]);
    }

    return rootByLineKey;
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
        try {
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
        } catch (err) {
          ewDebug("[EW cart] offer prefetch failed", err);
        }
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

  function findRemoveElement(container) {
  if (!container) return null;

  const selectors = [
    ".cart-item__remove",
    "[data-cart-remove]",
    "[data-remove]",
    "button[name='remove']",
    "a[href*='quantity=0']",
    "button[href*='quantity=0']"
  ];

  for (const selector of selectors) {
    const el = container.querySelector(selector);

    if (el && el.offsetParent !== null) {
      return el;
    }
  }

  return null;
}

  function isCartDrawerContainer(container) {
    if (!container) return false;
    return Boolean(
      container.closest(
        "cart-drawer, cart-drawer-component, #CartDrawer, .cart-drawer, .cart-drawer__items, .cart-drawer__item, [data-cart-drawer], [data-cart-drawer-items]"
      )
    );
  }

// True when the price sits in the product column, beside the title, rather than the line total.
function priceSitsWithProductTitle(el, container) {
  let node = el;
  for (let i = 0; i < 6; i += 1) {
    const parent = node?.parentElement;
    if (!parent || parent === container) return false;
    const title = parent.querySelector(
      ".cart-item__name, .cart-item__title, [data-cart-item-title], a[href*='/products/']"
    );
    if (title && parent.contains(el)) {
      const rect = parent.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      if (rect.width > 0 && rect.width < containerRect.width * 0.8) return true;
    }
    node = parent;
  }
  return false;
}

function findCartPagePriceElement(container) {
  if (!container) return null;

  /*
   * First use known selectors.
   */
  const selectors = [
    "[data-cart-item-price]",
    ".cart-item__final-price",
    ".cart-item__price",
    ".cart-item__price-wrapper",
    ".price-item--sale",
    ".price-item--regular",
    "[data-price]"
  ];

  for (const selector of selectors) {
    const matches = [...container.querySelectorAll(selector)].filter((el) => {
      if (!(el instanceof Element)) return false;
      if (el.closest(".ew-cart-slot")) return false;

      const style = window.getComputedStyle(el);

      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        el.textContent.trim() !== ""
      );
    });

    if (matches.length) {
      return matches.find((el) => priceSitsWithProductTitle(el, container)) || matches[matches.length - 1];
    }
  }

  /*
   * Sennheiser theme fallback.
   *
   * Find an element whose visible text contains
   * a currency formatted price.
   */
  const candidates = [...container.querySelectorAll("*")].filter((el) => {
    if (!(el instanceof Element)) return false;
    if (el.closest(".ew-cart-slot")) return false;

    const text = el.textContent?.trim() || "";

    if (!text) return false;

    const style = window.getComputedStyle(el);

    if (
      style.display === "none" ||
      style.visibility === "hidden"
    ) {
      return false;
    }

    return /(?:Rs\.?|₹|¥|￥|\$|€|£)\s*[\d,.]+|[\d,.]+\s*円/.test(text);
  });

  /*
   * Prefer the smallest element containing the actual
   * price text.
   */
  const priceCandidates = candidates.filter((el) => {
    return el.children.length <= 2;
  });

  const pool = priceCandidates.length ? priceCandidates : candidates;
  return pool.find((el) => priceSitsWithProductTitle(el, container)) || pool[pool.length - 1] || null;
}

function findCartPriceBlock(container) {
  if (!container) return null;

  const priceEl = findCartPagePriceElement(container);

  if (!priceEl) {
    ewDebug("[EW cart] Price element not found");
    return null;
  }

  /*
   * Walk upward from the actual price.
   *
   * We want the smallest parent that represents the
   * product information column, NOT the complete cart row.
   */
  let current = priceEl;

  for (let i = 0; i < 8; i += 1) {
    const parent = current.parentElement;

    if (!parent || parent === container) {
      break;
    }

    const rect = parent.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    const style = window.getComputedStyle(parent);

    const isLayoutContainer =
      style.display === "block" ||
      style.display === "flex" ||
      style.display === "inline-flex" ||
      style.display === "grid";

    /*
     * Don't select the complete cart row.
     */
    const isTooWide =
      rect.width >= containerRect.width * 0.9;

    /*
     * If the parent is reasonably narrow and contains
     * the product title + price, it is likely the
     * product information column.
     */
    const title = parent.querySelector(
      ".cart-item__name, " +
      ".cart-item__title, " +
      "[data-cart-item-title], " +
      "a[href*='/products/']"
    );

    if (
      isLayoutContainer &&
      !isTooWide &&
      title &&
      parent.contains(priceEl)
    ) {
      return parent;
    }

    current = parent;
  }

  /*
   * Second approach:
   * find the nearest ancestor that has the same left
   * edge as the product price.
   */
  const priceRect = priceEl.getBoundingClientRect();

  current = priceEl;

  for (let i = 0; i < 8; i += 1) {
    const parent = current.parentElement;

    if (!parent || parent === container) {
      break;
    }

    const rect = parent.getBoundingClientRect();

    const sameColumn =
      Math.abs(rect.left - priceRect.left) < 40;

    const reasonableWidth =
      rect.width < container.getBoundingClientRect().width * 0.85;

    if (sameColumn && reasonableWidth) {
      return parent;
    }

    current = parent;
  }

  /*
   * Final fallback: use the direct ancestor immediately
   * containing the price, but NEVER the complete cart row.
   */
  current = priceEl.parentElement;

  while (current && current.parentElement !== container) {
    current = current.parentElement;
  }

  return current && current !== container ? current : null;
}


// Finds the product-info column (the block that holds the product title) so the
// warranty button can sit under the price instead of at the bottom of the row.
function productInfoColumn(container, priceEl) {
  const title = container.querySelector(
    ".cart-item__name, .cart-item__title, [data-cart-item-title], a[href*='/products/']"
  );
  if (!title) return null;
  const containerRect = container.getBoundingClientRect();
  let node = title.parentElement;
  let best = title.parentElement;
  while (node && node !== container) {
    const rect = node.getBoundingClientRect();
    const holdsPrice = !priceEl || node.contains(priceEl);
    if (holdsPrice && rect.width > 0 && rect.width < containerRect.width * 0.75) {
      best = node;
    }
    node = node.parentElement;
  }
  return best;
}

function placeCartPageWarrantySlot(container, slot) {
  if (!container || !slot) return false;

  const priceEl = findCartPagePriceElement(container);

  slot.classList.remove("ew-cart-drawer-slot");
  slot.classList.add("ew-cart-page-slot");

  /*
   * Sennheiser cart: .product-row is a grid and .product-info is a row flex
   * (image | details). The unit price lives in .product-details. Insert there,
   * after .sale-price, so the button sits under the price and does not wrap
   * under the image as a full-width grid/flex line.
   */
  const details = container.querySelector(".product-details");
  if (details) {
    const priceStack = details.querySelector(".price-stack");
    const unitPrice = [...details.querySelectorAll(".sale-price")].find(
      (el) => !el.classList.contains("mobile")
    );
    const anchor = priceStack || unitPrice;
    if (anchor) anchor.insertAdjacentElement("afterend", slot);
    else details.appendChild(slot);
    return true;
  }

  /*
   * Preferred: append into the product-info column (the narrow block that holds
   * the title + price). This keeps the button on its own line directly under the
   * price, and never lets a full-width slot wrap to the outer row (which would
   * place it under the product image).
   */
  const column = productInfoColumn(container, priceEl);
  if (column && column !== container && (!priceEl || column.contains(priceEl))) {
    column.appendChild(slot);
    return true;
  }

  /*
   * Fallback: drop the warranty button right after the unit price when the price
   * sits inside the product-info column.
   */
  if (priceEl && priceSitsWithProductTitle(priceEl, container) && priceEl.parentElement) {
    priceEl.insertAdjacentElement("afterend", slot);
    return true;
  }

  /*
   * Last resort: place after the price wherever it was found.
   */
  if (priceEl && priceEl.parentElement) {
    priceEl.insertAdjacentElement("afterend", slot);
    return true;
  }

  return false;
}

 function upsertSlot(container, item, cart) {
  const html = slotMarkup(item, warrantyChildrenOf(cart, item));

  if (container.dataset.ewCartFallback !== "true") {
    container.querySelectorAll(".ew-cart-slot").forEach((existing) => {
      if (existing.dataset.ewParentKey !== item.key) {
        existing.remove();
      }
    });
  }

  let slot = container.querySelector(
    `.ew-cart-slot[data-ew-parent-key="${quoteAttr(item.key)}"]`
  );

  if (!html) {
    if (slot) slot.remove();
    return;
  }

  const mode = getCartDisplayMode(container);

  /*
   * Create warranty slot
   */
  if (!slot) {
    slot = document.createElement("div");
    slot.className = "ew-cart-slot";
  }

  /*
   * CART DRAWER
   * Add Warranty should be beside Remove.
   */
  if (mode === "drawer") {
    const removeEl = findRemoveElement(container);

    if (removeEl) {
      let row = removeEl.closest(".ew-cart-line-row");

      if (!row) {
        row = document.createElement("div");
        row.className = "ew-cart-line-row";

        const parent = removeEl.parentElement;

        if (parent) {
          parent.insertBefore(row, removeEl);
          row.appendChild(removeEl);
        } else {
          container.appendChild(row);
          row.appendChild(removeEl);
        }
      }

      if (slot.parentElement !== row) {
        row.appendChild(slot);
      }
    } else {
      if (slot.parentElement !== container) {
        container.appendChild(slot);
      }
    }

    slot.classList.remove("ew-cart-page-slot");
    slot.classList.add("ew-cart-drawer-slot");
  }

  /*
   * CART PAGE
   * Add Warranty should be directly below the price/discount.
   */
  else if (container.dataset.ewCartFallback === "true") {
    if (slot.parentElement !== container) container.appendChild(slot);
    slot.classList.remove("ew-cart-drawer-slot");
    slot.classList.add("ew-cart-page-slot");
  } else {
  const placed = placeCartPageWarrantySlot(container, slot);

  if (!placed) {
    slot.remove();
    ewDebug("[EW cart] Could not place warranty button under product price", container);
    return;
  }

  slot.classList.remove("ew-cart-drawer-slot");
  slot.classList.add("ew-cart-page-slot");
}


  /*
   * Update slot data/content
   */
  slot.dataset.ewParentKey = item.key;

  if (slot.innerHTML !== html) {
    slot.innerHTML = html;
  }

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

    const rootByLineKey = resolveLineRoots(cart);
    const missing = [];
    for (const item of cart.items || []) {
      if (isWarrantyCatalogItem(item)) continue;
      const root = rootByLineKey.get(item.key);
      if (!root) {
        missing.push(item);
        continue;
      }
      upsertSlot(root, item, cart);
    }

    let fallback = document.querySelector("[data-ew-cart-fallback]");
    if (!missing.length) {
      if (fallback) fallback.remove();
    } else {
      fallback = fallback || cartFallbackHost();
      if (fallback) missing.forEach((item) => upsertSlot(fallback, item, cart));
    }
  }

  async function refreshCartUi() {
    if (cartUiRendering) return;
    cartUiRendering = true;
    try {
      const cart = await readCart();
      if (!cart) return;
      const reconciled = (await reconcileCart(cart)) || cart;
      renderCartSlots(reconciled);
      await hydrateCartEligibility(reconciled);
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

    const initialParent = existing.length
      ? ((await readCart()) || cart).items.find((item) => item.key === current.key) || current
      : current;
    const groupId = propertyMap(initialParent)._ew_group_id || createGroupId();
    const variantId = normalizeVariantId(initialParent.variant_id || initialParent.id);

    // Stamp the parent before creating the child. /cart/change.js rewrites the
    // line key, so doing it afterwards would leave the warranty pointing at a
    // line that no longer exists.
    const stamped = await updateLineProperties(initialParent, {
      _ew_plan_id: String(plan.planId),
      _ew_group_id: groupId,
    });
    const latestParent =
      (stamped?.items || []).find(
        (item) =>
          !isWarrantyLine(item) &&
          propertyMap(item)._ew_group_id === groupId &&
          normalizeVariantId(item.variant_id || item.id) === variantId
      ) || initialParent;

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
    let addedCart;
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
      addedCart = await response.json();
    } finally {
      ewInternal = previous;
    }

    // Warranty is in the cart now — let the caller (modal) proceed immediately.
    // Reconciliation, section HTML refresh, and the theme cart-updated event
    // are UI-refresh concerns, not part of "did the add succeed", so they run
    // in the background instead of blocking the save button.
    finalizeWarrantyAdd().catch((err) => ewDebug("[EW cart] background sync failed", err));

    return addedCart;
  }

  async function finalizeWarrantyAdd() {
    const refreshed = await readCart();
    if (!refreshed) return;
    const reconciled = await reconcileCart(refreshed);
    const withSections = await cartWithSections(reconciled);
    notifyCartChanged(withSections);
  }

  let postAddAttaching = false;

  // Attaches a PDP-selected warranty to its product after an add-to-cart that did
  // not flow through the fetch hook (themes that add via XMLHttpRequest). Scoped to
  // the add event so a plain plan selection never triggers an add. Runs the same
  // reliable cart flow as the cart-page "Add Warranty" button.
  async function attachSelectedWarrantiesAfterAdd() {
    if (postAddAttaching || !widgets.size) return;
    postAddAttaching = true;
    try {
      let cart = await readCart();
      if (!cart) return;
      for (const state of widgets.values()) {
        const plan = selectedPlan(state);
        if (!plan) continue;
        const variantId = normalizeVariantId(state.variantId);
        const parent = (cart.items || []).find(
          (item) =>
            !isWarrantyLine(item) &&
            !isWarrantyCatalogItem(item) &&
            normalizeVariantId(item.variant_id || item.id) === variantId &&
            warrantyChildrenOf(cart, item).length === 0
        );
        if (!parent) continue;
        try {
          await addWarrantyToLine(parent, plan);
          state.selectedPlanId = null;
          state.cartError = "";
          renderWidget(state);
          cart = (await readCart()) || cart;
        } catch (err) {
          ewDebug("[EW PDP] Post-add warranty attach failed", err);
          state.cartError = WARRANTY_CART_ERROR;
          renderWidget(state);
        }
      }
    } finally {
      postAddAttaching = false;
    }
  }

  async function removeWarrantyLine(warrantyKey) {
    const cart = await readCart();
    if (!cart) return;
    const warranty = (cart.items || []).find((item) => item.key === warrantyKey);
    if (!warranty) return;
    const parent = findWarrantyParent(cart, warranty);
    const afterRemoval = (await setLineQuantity(warrantyKey, 0)) || cart;
    const remainingParent = parent
      ? (afterRemoval.items || []).find((item) => item.key === parent.key)
      : null;
    if (remainingParent && !warrantyChildrenOf(afterRemoval, remainingParent).length) {
      const props = { ...propertyMap(remainingParent) };
      delete props._ew_plan_id;
      delete props._ew_group_id;
      await replaceLineProperties(remainingParent, props);
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
        offer: peekCachedOffer(productId, variantId),
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
        offer: peekCachedOffer(parent.product_id, parent.variant_id || parent.id),
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
        let parent = (cart?.items || []).find((item) => item.key === context.parentLineKey);
        if (!parent) {
          // The cached line key can go stale after cart edits/reconcile (Shopify
          // rewrites line keys). Re-resolve the line by its variant/product so a
          // first attempt does not fail with a stale key. Prefer the line that
          // has no warranty yet, since this flow is "Add Warranty".
          const variantId = normalizeVariantId(context.variantId);
          const candidates = (cart?.items || []).filter(
            (item) =>
              !isWarrantyLine(item) &&
              !isWarrantyCatalogItem(item) &&
              normalizeVariantId(item.variant_id || item.id) === variantId &&
              (!context.productId ||
                String(lineProductId(item)) === String(context.productId))
          );
          parent =
            candidates.find((item) => warrantyChildrenOf(cart, item).length === 0) ||
            candidates[0] ||
            null;
        }
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
    if (closestFromEvent(event, "[data-ew-retry-modal]")) {
      retrySharedModal();
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
    if (event.target.closest("[data-ew-retry]")) {
      clearCachedOffer(state.productId, state.variantId);
      loadForVariant(state, state.variantId, { keepSelection: true });
      return;
    }
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


// ----
// (() => {
//   /* ===============================
//      CUSTOMER NAME HANDLING
//   =============================== */
//   const nameInput = document.getElementById("customerName");
//   if (!nameInput) return;

//   if (nameInput.value.trim()) {
//     nameInput.readOnly = true;
//   } else {
//     nameInput.readOnly = false;
//     nameInput.placeholder = "Enter your full name";
//   }

//   const emailInput = document.getElementById("customerEmail");
//   const customerIdInput = document.getElementById("customerId");

//   const consent1 = document.getElementById("consentCheckbox1");
//   const consent2 = document.getElementById("consentCheckbox2");

//   const consentPrivacyError = document.getElementById("consentPrivacyError");
//   const consentConfirmError = document.getElementById("consentConfirmError");

//   const externalProducts = document.getElementById("externalProducts");
//   const addProductBtn = document.getElementById("addProduct");

//   const infoIconUrl = document.getElementById("info-icon").value;

//   let retailerRequired = true;

//   /* ===============================
//      ERROR HELPERS
//   =============================== */
//   function showError(el, msg) {
//     const err = el.closest(".form-input")?.querySelector(".field-error");
//     if (err) err.textContent = msg;
//     el.classList.add("has-error");
//   }

//   function clearError(el) {
//     const err = el.closest(".form-input")?.querySelector(".field-error");
//     if (err) err.textContent = "";
//     el.classList.remove("has-error");
//   }

//   function scrollToError(el) {
//     el.scrollIntoView({ behavior: "smooth", block: "center" });
//     el.focus?.();
//   }

//   /* ===============================
//      SERIAL VALIDATION
//   =============================== */
//   function validateSerial(input, silent = false) {
//     const value = input.value.trim();

//     if (!value) {
//       if (!silent) showError(input, "Serial number is required");
//       return false;
//     }

//     if (!/^[a-zA-Z0-9]+$/.test(value)) {
//       if (!silent) showError(input, "Only letters and numbers allowed");
//       return false;
//     }

//     if (value.length < 10) {
//       if (!silent) showError(input, "Minimum 10 characters required");
//       return false;
//     }

//     if (value.length > 20) {
//       if (!silent) showError(input, "Maximum 20 characters allowed");
//       return false;
//     }

//     clearError(input);
//     return true;
//   }

//   /* ===============================
//      LIVE ERROR CLEAR
//   =============================== */
//   document.addEventListener("input", (e) => {
//     if (e.target.classList.contains("has-error")) {
//       clearError(e.target);
//     }
//   });

//   consent1?.addEventListener("change", () => {
//     if (consent1.checked) consentPrivacyError.textContent = "";
//   });

//   consent2?.addEventListener("change", () => {
//     if (consent2.checked) consentConfirmError.textContent = "";
//   });

//   /* ===============================
//      ADD EXTERNAL PRODUCT
//   =============================== */
//   async function addExternalProduct() {

//     const template = document.getElementById("external-product-template");
//     const clone = template.content.cloneNode(true);
//     const wrap = clone.querySelector(".product-block");
//     const dateInput = wrap.querySelector(".purchase-date");
//     if (dateInput) {
//       dateInput.max = new Date().toISOString().split("T")[0];
//     }
//     wrap.querySelector(".remove").onclick = () => {

//       wrap.remove();

//       const remaining = document.querySelectorAll(".external-products-wrapper");
//       const productsError = document.getElementById("externalProductsError");

//       if (remaining.length === 0 && productsError) {
//         productsError.textContent = "Please register at least one product.";
//       }

//     };

//     externalProducts.appendChild(clone);

//     initProductAutocomplete(wrap);
//     initRetailerAutocomplete(wrap);
//     initTooltipToggle(wrap);

//     const serialInput = wrap.querySelector("[data-serial]");

//     serialInput.addEventListener("input", () => {

//       clearError(serialInput);

//       if (serialInput.value.trim().length >= 10) {
//         validateSerial(serialInput, true);
//       }

//     });

//   }


//   addProductBtn?.addEventListener("click", addExternalProduct);

//   /* ===============================
//      PRODUCT AUTOCOMPLETE
//   =============================== */
//   function initProductAutocomplete(container) {
//     const input = container.querySelector("[data-autocomplete]");
//     if (!input) return;

//     const list = document.createElement("div");
//     list.className = "autocomplete-results";
//     input.closest(".form-input").appendChild(list);

//     let timer = null;

//     input.addEventListener("input", () => {
//       input.dataset.productId = "";
//       clearTimeout(timer);

//       const q = input.value.trim();
//       if (q.length < 2) {
//         list.innerHTML = "";
//         list.style.display = "none";
//         return;
//       }

//       timer = setTimeout(async () => {
//         const res = await fetch(
//           `/apps/warranty/autocomplete/products?q=${encodeURIComponent(q)}`,
//         );
//         const items = await res.json();

//         list.innerHTML = items
//           .map(
//             (p) => `
//           <div class="autocomplete-item"
//             data-id="${p.id}"
//             data-title="${p.title}">
//             ${p.title}
//           </div>
//         `,
//           )
//           .join("");

//         list.style.display = items.length ? "block" : "none";
//       }, 300);
//     });

//     list.addEventListener("click", (e) => {
//       const item = e.target.closest(".autocomplete-item");
//       if (!item) return;

//       input.value = item.dataset.title;
//       input.dataset.productId = item.dataset.id;
//       list.innerHTML = "";
//       list.style.display = "none";
//     });
//   }

//   /* ===============================
//      RETAILER AUTOCOMPLETE
//   =============================== */

//   function normalizeLangCode(lang) {
//     const code = String(lang || "en").trim().split("-")[0].toLowerCase();
//     return /^[a-z]{2}$/.test(code) ? code : "en";
//   }

//   function getRetailerSearchLang() {
//     const raw =
//       (window.Weglot && typeof Weglot.getCurrentLang === "function"
//         ? Weglot.getCurrentLang()
//         : "") ||
//       document.getElementById("storefrontLocale")?.value?.trim() ||
//       window.Shopify?.locale ||
//       document.documentElement.lang ||
//       navigator.language ||
//       "en";
//     return normalizeLangCode(raw);
//   }

//   function getRetailerDisplayName(r, lang) {
//     if (normalizeLangCode(lang) === "en") {
//       return r.name_en || "";
//     }
//     return r.name_localized || r.name_ja || r.name_en || "";
//   }

//   function initRetailerAutocomplete(container) {
//     const input = container.querySelector("[data-retailer-autocomplete]");
//     if (!input) return;

//     const lang = getRetailerSearchLang();

//     const list = document.createElement("div");
//     list.className = "autocomplete-results";
//     input.closest(".form-input").appendChild(list);

//     let retailers = [];

//     async function loadRetailers() {
//       if (retailers.length) return;

//       try {
//         const res = await fetch(
//           `/apps/warranty/retailers?lang=${lang}`
//         );

//         retailers = await res.json();
//       } catch (err) {
//         console.error(err);
//       }
//     }

//     function renderRetailers(items) {
//       list.innerHTML = items
//         .map(
//           (r) => `
//           <div
//             class="autocomplete-item"
//             data-name="${getRetailerDisplayName(r, lang)}"
//             data-name-en="${getRetailerDisplayName(r, 'en')}">
//             ${getRetailerDisplayName(r, lang)}
//           </div>
//         `
//         )
//         .join("");

//       list.style.display = items.length ? "block" : "none";
//     }

//     // Show all retailers on focus
//     input.addEventListener("focus", async () => {
//       input.dataset.valid = "";

//       await loadRetailers();

//       renderRetailers(retailers);
//     });

//     // Reopen dropdown when clicking the input again
//     input.addEventListener("click", () => {
//       if (retailers.length) {
//         renderRetailers(retailers);
//       }
//     });

//     // Filter retailers while typing
//     input.addEventListener("input", () => {
//       input.dataset.valid = "";

//       const q = input.value.trim().toLowerCase();

//       const filtered = retailers.filter((r) =>
//         getRetailerDisplayName(r, lang)
//           .toLowerCase()
//           .includes(q)
//       );

//       renderRetailers(filtered);
//     });

//     // Select retailer
//     list.addEventListener("click", (e) => {
//       const item = e.target.closest(".autocomplete-item");
//       if (!item) return;

//       input.value = item.dataset.name;
//       input.dataset.nameEn = item.dataset.nameEn;
//       input.dataset.valid = "true";

//       clearError(input);

//       list.innerHTML = "";
//       list.style.display = "none";
//     });

//     // Close dropdown when clicking outside
//     document.addEventListener("click", (e) => {
//       const isInput = e.target === input;
//       const isList = list.contains(e.target);

//       if (!isInput && !isList) {
//         list.style.display = "none";
//       }
//     });
//   }

//   function validateDuplicateSerials(productBlocks) {
//     const serialMap = {};
//     let hasDuplicate = false;

//     productBlocks.forEach((block) => {
//       const serialInput = block.querySelector("[data-serial]");
//       const value = serialInput.value.trim().toLowerCase();

//       if (!value) return;

//       if (serialMap[value]) {
//         hasDuplicate = true;

//         showError(serialInput, "This serial number is already entered above.");
//         showError(
//           serialMap[value],
//           "This serial number is already entered below.",
//         );
//       } else {
//         serialMap[value] = serialInput;
//       }
//     });

//     return !hasDuplicate;
//   }

//   /* ===============================
//    TOOLTIP CLICK TOGGLE
// =============================== */
//   function initTooltipToggle(container) {
//     const wraps = container.querySelectorAll(".custom-toolip-wrap");

//     wraps.forEach((wrap) => {
//       const trigger = wrap.querySelector(".info-icon");
//       if (!trigger) return;

//       trigger.addEventListener("click", (e) => {
//         e.stopPropagation();

//         const isActive = wrap.classList.contains("active");

//         // close any other open tooltips first
//         document.querySelectorAll(".custom-toolip-wrap.active").forEach((w) => {
//           if (w !== wrap) w.classList.remove("active");
//         });

//         wrap.classList.toggle("active", !isActive);
//       });

//       // keyboard support since it's now a role="button"
//       trigger.addEventListener("keydown", (e) => {
//         if (e.key === "Enter" || e.key === " ") {
//           e.preventDefault();
//           trigger.click();
//         }
//       });
//     });
//   }

//   // close tooltip(s) when clicking anywhere outside
//   document.addEventListener("click", (e) => {
//     if (!e.target.closest(".custom-toolip-wrap")) {
//       document.querySelectorAll(".custom-toolip-wrap.active").forEach((w) => {
//         w.classList.remove("active");
//       });
//     }
//   });

//   /* ===============================
//      EXTERNAL FLOW VALIDATION
//   =============================== */
//   function validateExternalFlow() {
//     let valid = true;
//     let firstError = null;

//     const productBlocks = document.querySelectorAll(
//       ".external-products-wrapper",
//     );
//     const productsError = document.getElementById("externalProductsError");

//     /* =================================================
//       ⭐ REQUIRE AT LEAST ONE PRODUCT
//     ================================================= */
//     if (productBlocks.length === 0) {
//       if (productsError) {
//         productsError.textContent = "Please register at least one product.";
//       }

//       valid = false;
//       firstError = productsError;

//       scrollToError(productsError);
//       return false; // stop further validation
//     } else {
//       if (productsError) {
//         productsError.textContent = "";
//       }
//     }

//     productBlocks.forEach((block) => {
//       const product = block.querySelector("[data-autocomplete]");
//       const date = block.querySelector("input[type=date]");
//       const retailer = block.querySelector("[data-retailer-autocomplete]");
//       const serial = block.querySelector("[data-serial]");

//       if (!product.value.trim()) {
//         showError(product, "Product is required");
//         valid = false;
//         firstError ??= product;
//       } else if (!product.dataset.productId) {
//         showError(product, "Select a product from the list");
//         valid = false;
//         firstError ??= product;
//       }

//       if (!date.value) {
//         showError(date, "Purchase date is required");
//         valid = false;
//         firstError ??= date;
//       }

//       if (!validateSerial(serial)) {
//         valid = false;
//         firstError ??= serial;
//       }

//       if (retailerRequired) {
//         if (!retailer.value.trim()) {
//           showError(retailer, "Retailer is required");
//           valid = false;
//           firstError ??= retailer;
//         } else if (retailer.dataset.valid !== "true") {
//           showError(retailer, "Select retailer from list");
//           valid = false;
//           firstError ??= retailer;
//         }
//       }
//     });

//     /* =================================================
//       ⭐ CHECK DUPLICATE SERIAL NUMBERS
//     ================================================= */
//     if (!validateDuplicateSerials(productBlocks)) {
//       valid = false;
//       if (!firstError) {
//         firstError = productBlocks[0].querySelector("[data-serial]");
//       }
//     }

//     consentPrivacyError.textContent = "";
//     consentConfirmError.textContent = "";

//     if (!consent1.checked) {
//       consentPrivacyError.textContent = "You must accept the privacy notice.";
//       valid = false;
//       firstError ??= consent1;
//     }

//     if (!consent2.checked) {
//       consentConfirmError.textContent = "You must confirm your information.";
//       valid = false;
//       firstError ??= consent2;
//     }

//     if (!valid && firstError) scrollToError(firstError);
//     return valid;
//   }

//   /* ===============================
//      SUBMIT
//   =============================== */
//   document.getElementById("twsForm")?.addEventListener("submit", async (e) => {
//     e.preventDefault();

//     if (!validateExternalFlow()) return;

//     const submitBtn = e.submitter || e.target.querySelector('[type="submit"]');
//     const myProductLink = document.getElementById("my_products_link").value;

//     const payload = {
//       flow: "external",
//       consent_privacy: consent1.checked,
//       consent_confirm: consent2.checked,

//       customer: {
//         id: customerIdInput?.value || null,
//         name: nameInput.value.trim(),
//         email: emailInput.value.trim(),
//       },

//       products: [],
//     };

//     // include storefront locale for server-side email language selection
//     const storefrontLocale =
//       document.getElementById("storefrontLocale")?.value?.trim() ||
//       document.documentElement.lang ||
//       window.Shopify?.locale ||
//       navigator.language ||
//       "en";

//     payload.locale = storefrontLocale;

//     if (submitBtn) submitBtn.disabled = true;
//     window.ExtendedWarrantyOffer?.showPageLoader?.("Registering your product...");

//     document.querySelectorAll(".external-products-wrapper").forEach((block) => {
//       const retailer = block.querySelector("[data-retailer-autocomplete]");
//       payload.products.push({
//         product_id: block.querySelector("[data-autocomplete]").dataset.productId,
//         product_name: block.querySelector("[data-autocomplete]").value,
//         retailer_name: retailer.dataset.nameEn || "",
//         purchase_date: block.querySelector("input[type=date]").value,
//         serial_number: block.querySelector("[data-serial]").value.trim(),
//       });
//     });
//     //The storefront form collects product, serial number, retailer, and purchase date, then posts to /apps/warranty/register. 
//     // It handles validation, duplicate serials, and consent checkboxes, showing errors and disabling the submit button during submission.
//     try {
//       const res = await fetch("/apps/warranty/register", {
//         method: "POST",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify(payload),
//       });

//       const data = await res.json().catch(() => ({}));

//       if (!res.ok || data.success === false) {
//         const errorMessage = window.WarrantyFlowState?.formatRegistrationError
//           ? window.WarrantyFlowState.formatRegistrationError(data, res.status)
//           : data.message ||
//             data.error ||
//             (res.status >= 500
//               ? "Registration failed. Please try again."
//               : "Registration failed. Please check your details and try again.");

//         window.WarrantyToast?.showError?.(errorMessage);

//         const serialInput = document.querySelector("input[data-serial]");
//         const productInput = document.querySelector("[data-autocomplete]");
//         const isPlanError =
//           data.reason === "no_standard_warranty_plan" ||
//           /standard warranty|not configured|duration/i.test(errorMessage);

//         if (/serial|already been registered/i.test(errorMessage) && serialInput) {
//           showError(serialInput, errorMessage);
//         } else if (isPlanError && productInput) {
//           showError(productInput, errorMessage);
//         } else if (serialInput && !isPlanError) {
//           showError(serialInput, errorMessage);
//         }

//         window.ExtendedWarrantyOffer?.hidePageLoader?.();
//         window.ExtendedWarrantyOffer?.showRegistrationForm?.();
//         if (submitBtn) submitBtn.disabled = false;
//         return;
//       }

//       if (data.success === true) {
//         window.scrollTo({ top: 0, behavior: "smooth" });

//         const primary = data.registrations?.[0];
//         const shouldShowEw =
//           window.WarrantyFlowState?.isExtendedWarrantyOfferEnabledInResponse?.(data) ||
//           data?.postRegistrationNavigation?.next === "extended_warranty";
//         const noEwPlans = window.WarrantyFlowState?.hasNoExtendedWarrantyPlans?.(data);

//         if (primary?.registerId && shouldShowEw && !noEwPlans) {
//           window.WarrantyFlowState?.savePostRegistration({
//             registerId: primary.registerId,
//             customerEmail: emailInput.value.trim(),
//             customerName: nameInput.value.trim(),
//             myProductsLink: myProductLink,
//           });
//         }

//         window.WarrantyToast?.showSuccess("Product registered successfully");

//         if (shouldShowEw && !noEwPlans) {
//           window.ExtendedWarrantyOffer?.showPageLoader?.(
//             "Loading extended warranty options..."
//           );
//         } else {
//           window.ExtendedWarrantyOffer?.hidePageLoader?.();
//         }

//         await window.WarrantyFlowState?.handlePostRegistrationNavigation(data, {
//           myProductsLink: myProductLink,
//           customerEmail: emailInput.value.trim(),
//           customerName: nameInput.value.trim(),
//         });
//       }
//     } catch {
//       window.ExtendedWarrantyOffer?.hidePageLoader?.();
//       window.ExtendedWarrantyOffer?.showRegistrationForm?.();
//       if (submitBtn) submitBtn.disabled = false;
//       window.WarrantyToast?.showError?.(
//         "Something went wrong. Please try again.",
//       );
//     }
//   });

//   /* ===============================
//      INIT
//   =============================== */
//   //  loadStoreSettings().then(addExternalProduct);

//   document.addEventListener("DOMContentLoaded", async () => {
//     await loadStoreSettings();
//     addExternalProduct();

//     const myProductLink =
//       document.getElementById("my_products_link")?.value || "/pages/my-products";
//     const initResult = await window.WarrantyFlowState?.initRegistrationPage({
//       myProductsLink: myProductLink,
//     });
//     if (initResult?.restored && !initResult?.redirected) {
//       window.WarrantyToast?.showInfo(
//         "Continue selecting your extended warranty plan."
//       );
//     }
//   });

//   async function loadStoreSettings() {
//     try {
//       const res = await fetch("/apps/warranty/retailerSettings");
//       const data = await res.json();
//       retailerRequired = !!data.retailer_required;
//     } catch {
//       retailerRequired = true;
//     }
//   }
// })();
