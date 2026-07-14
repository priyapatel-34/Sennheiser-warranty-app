/**
 * PDP Extended Warranty upsell.
 *
 * Business logic (eligibility, pricing, coverage) lives entirely in the
 * Warranty App backend behind `/apps/warranty/plans` — this file only
 * renders the UI, calls that API, and (when a plan is selected) adds the
 * product + warranty variant to the cart via the native Shopify AJAX Cart
 * API. If no plans are eligible or the API fails, the block hides itself
 * and the theme's default Add to cart behaviour is left completely
 * untouched (no plan selected == no interception at all).
 */
(() => {
    const CACHE_TTL_MS = 5 * 60 * 1000;
    const VARIANT_POLL_MS = 700;

    function cacheKey(shop, variantId) {
        return `ew_pdp_plans:${shop}:${variantId || "none"}`;
    }

    function readCache(shop, variantId) {
        try {
            const raw = sessionStorage.getItem(cacheKey(shop, variantId));
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || Date.now() - parsed.ts > CACHE_TTL_MS) return null;
            return parsed.data;
        } catch {
            return null;
        }
    }

    function writeCache(shop, variantId, data) {
        try {
            sessionStorage.setItem(
                cacheKey(shop, variantId),
                JSON.stringify({ ts: Date.now(), data })
            );
        } catch {
            // Storage unavailable (private mode, quota) — degrade to no caching.
        }
    }

    async function fetchPlans(shop, productId, variantId) {
        const cached = readCache(shop, variantId);
        if (cached) return cached;

        const params = new URLSearchParams({ product_id: productId });
        if (variantId) params.set("variant_id", variantId);

        const res = await fetch(`/apps/warranty/plans?${params.toString()}`, {
            headers: { Accept: "application/json" },
        });
        if (!res.ok) throw new Error("Failed to load protection plans");
        const data = await res.json();
        writeCache(shop, variantId, data);
        return data;
    }

    function findProductForm(container) {
        return (
            container.closest("form[action*='/cart/add']") ||
            document.querySelector("form[action*='/cart/add']")
        );
    }

    function findQuantity(form) {
        const qtyInput = form?.querySelector('[name="quantity"]');
        const qty = qtyInput ? parseInt(qtyInput.value, 10) : 1;
        return Number.isFinite(qty) && qty > 0 ? qty : 1;
    }

    async function addProductAndWarrantyToCart({ productVariantId, plan, quantity }) {
        const items = [{ id: Number(productVariantId), quantity }];

        if (plan) {
            items.push({
                id: Number(plan.shopifyVariantId),
                quantity,
                properties: {
                    _warranty_plan_id: String(plan.planId),
                    _warranty_for_variant_id: String(productVariantId),
                    _warranty_for_product_id: String(plan.__productId || ""),
                    _warranty_source: "pdp",
                },
            });
        }

        const res = await fetch("/cart/add.js", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ items }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data?.description || data?.message || "Failed to add to cart");
        }
        return data;
    }

    function notifyCartUpdated() {
        // Best-effort, theme-agnostic signal — harmless no-op for themes that
        // don't listen for these; the AJAX add itself is what actually
        // updates the cart, so correctness never depends on this firing.
        document.dispatchEvent(new CustomEvent("cart:refresh", { bubbles: true }));
        document.dispatchEvent(new CustomEvent("cart:updated", { bubbles: true }));
    }

    function showSuccessBanner(container) {
        container.querySelector(".wpc-added-banner")?.remove();
        const banner = document.createElement("div");
        banner.className = "wpc-added-banner";
        banner.textContent = "Added to your cart, including the selected protection plan.";
        container.prepend(banner);
        setTimeout(() => banner.remove(), 5000);
    }

    function initBlock(container) {
        const shop = container.dataset.shop;
        const productId = container.dataset.productId;
        if (!shop || !productId) return;

        let variantId = container.dataset.variantId || null;
        let currentPlans = [];
        let selectedPlan = null;
        let loadToken = 0;

        function paint() {
            const cardsHtml = window.WarrantyPlanCard.renderPlanCards(currentPlans, {
                groupName: `ew-pdp-plan-${productId}`,
                selectedPlanId: selectedPlan?.planId || null,
                allowNone: true,
                noneLabel: "No protection",
            });

            container.innerHTML = `
        <div class="wpc-pdp-block">
          <h3 class="wpc-pdp-title">Product Protection</h3>
          ${cardsHtml}
        </div>
      `;

            container.querySelectorAll('input[type="radio"]').forEach(input => {
                input.addEventListener("change", () => {
                    selectedPlan =
                        currentPlans.find(p => String(p.planId) === input.value) || null;
                });
            });
        }

        async function load() {
            const token = ++loadToken;
            try {
                const data = await fetchPlans(shop, productId, variantId);
                if (token !== loadToken) return;

                currentPlans = (data.plans || []).map(p => ({ ...p, __productId: productId }));

                if (!data.eligible || !currentPlans.length) {
                    container.hidden = true;
                    container.innerHTML = "";
                    selectedPlan = null;
                    return;
                }

                selectedPlan = null;
                container.hidden = false;
                paint();
            } catch (err) {
                if (token !== loadToken) return;
                console.warn("[Extended Warranty] PDP plans unavailable:", err.message);
                container.hidden = true;
                container.innerHTML = "";
            }
        }

        function refreshForVariant(newVariantId) {
            const normalized = newVariantId ? String(newVariantId) : null;
            if (!normalized || normalized === variantId) return;
            variantId = normalized;
            load();
        }

        load();

        const form = findProductForm(container);

        if (form) {
            form.addEventListener(
                "submit",
                async evt => {
                    if (!selectedPlan) return; // No plan selected — default add-to-cart is untouched.

                    evt.preventDefault();
                    evt.stopImmediatePropagation();

                    const submitBtn = form.querySelector('[type="submit"]');
                    if (submitBtn) submitBtn.disabled = true;

                    try {
                        const idInput = form.querySelector('[name="id"]');
                        const activeVariantId = idInput?.value || variantId;
                        const quantity = findQuantity(form);

                        await addProductAndWarrantyToCart({
                            productVariantId: activeVariantId,
                            plan: selectedPlan,
                            quantity,
                        });

                        notifyCartUpdated();
                        showSuccessBanner(container);
                    } catch (err) {
                        console.warn("[Extended Warranty] Add to cart failed:", err.message);
                        if (window.WarrantyToast?.showError) {
                            window.WarrantyToast.showError(
                                err.message || "Could not add to cart. Please try again."
                            );
                        }
                    } finally {
                        if (submitBtn) submitBtn.disabled = false;
                    }
                },
                true
            );

            const idInput = form.querySelector('[name="id"]');
            if (idInput) {
                idInput.addEventListener("change", () => refreshForVariant(idInput.value));

                // Some themes update the variant id input's `.value` via JS
                // without emitting a `change` event. A light poll is the most
                // reliable cross-theme fallback for that case.
                let lastKnownValue = idInput.value;
                setInterval(() => {
                    if (idInput.value !== lastKnownValue) {
                        lastKnownValue = idInput.value;
                        refreshForVariant(idInput.value);
                    }
                }, VARIANT_POLL_MS);
            }
        }

        document.addEventListener("variant:change", evt => {
            const newId = evt.detail?.variant?.id || evt.detail?.id;
            if (newId) refreshForVariant(newId);
        });
    }

    function initAll() {
        document.querySelectorAll(".wpc-pdp-warranty[data-shop]").forEach(el => {
            if (el.__ewInitialized) return;
            el.__ewInitialized = true;
            initBlock(el);
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initAll);
    } else {
        initAll();
    }
    document.addEventListener("shopify:section:load", initAll);
})();
