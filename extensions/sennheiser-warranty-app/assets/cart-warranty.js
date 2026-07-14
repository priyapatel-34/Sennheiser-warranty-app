/**
 * Cart Extended Warranty upsell.
 *
 * Renders one warranty selector per cart line that doesn't already have a
 * linked protection plan, using the same shared Plan Card component and the
 * same dynamic `/apps/warranty/plans` API as the PDP block — no business
 * logic duplicated here, this file only reads the cart, renders UI, and
 * adds/removes/syncs warranty line items via the native Shopify AJAX Cart
 * API. If the plans API fails or returns nothing for a product, that
 * product's warranty section is simply omitted; the cart and checkout are
 * never blocked.
 */
(() => {
    const CACHE_TTL_MS = 5 * 60 * 1000;
    const CART_POLL_MS = 2500;
    const WARRANTY_PROP = "_warranty_plan_id";

    function cacheKey(shop, productId, variantId) {
        return `ew_cart_plans:${shop}:${productId}:${variantId || "none"}`;
    }

    function readCache(shop, productId, variantId) {
        try {
            const raw = sessionStorage.getItem(cacheKey(shop, productId, variantId));
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || Date.now() - parsed.ts > CACHE_TTL_MS) return null;
            return parsed.data;
        } catch {
            return null;
        }
    }

    function writeCache(shop, productId, variantId, data) {
        try {
            sessionStorage.setItem(
                cacheKey(shop, productId, variantId),
                JSON.stringify({ ts: Date.now(), data })
            );
        } catch {
            // Storage unavailable — degrade to no caching.
        }
    }

    function escapeHtml(str) {
        return window.WarrantyPlanCard?.escapeHtml
            ? window.WarrantyPlanCard.escapeHtml(str)
            : String(str ?? "");
    }

    async function getCart() {
        const res = await fetch("/cart.js", { headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error("Failed to load cart");
        return res.json();
    }

    function isWarrantyLine(item) {
        return Boolean(item.properties && item.properties[WARRANTY_PROP]);
    }

    function buildGroups(cart) {
        const productLines = cart.items.filter(i => !isWarrantyLine(i));
        const warrantyLines = cart.items.filter(isWarrantyLine);

        // Assumes one cart line per distinct variant for plain product lines,
        // which holds under Shopify's default cart-merge behaviour (identical
        // variant + properties collapse into a single line with quantity > 1).
        return productLines.map(line => ({
            line,
            linkedWarranty:
                warrantyLines.find(
                    w => String(w.properties._warranty_for_variant_id) === String(line.variant_id)
                ) || null,
        }));
    }

    async function fetchPlansForGroups(shop, groups) {
        const needed = groups.filter(g => !g.linkedWarranty);
        const results = {};
        if (!needed.length) return results;

        const toFetch = [];
        for (const g of needed) {
            const key = `${g.line.product_id}:${g.line.variant_id}`;
            const cached = readCache(shop, g.line.product_id, g.line.variant_id);
            if (cached) {
                results[key] = cached;
            } else {
                toFetch.push({ productId: g.line.product_id, variantId: g.line.variant_id, key });
            }
        }

        if (toFetch.length) {
            try {
                const res = await fetch("/apps/warranty/plans/batch", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Accept: "application/json" },
                    body: JSON.stringify({
                        items: toFetch.map(t => ({ productId: t.productId, variantId: t.variantId })),
                    }),
                });
                const data = await res.json();
                for (const t of toFetch) {
                    const value = data?.results?.[t.key] || { eligible: false, plans: [] };
                    results[t.key] = value;
                    writeCache(shop, t.productId, t.variantId, value);
                }
            } catch (err) {
                console.warn("[Extended Warranty] Cart plans unavailable:", err.message);
                for (const t of toFetch) {
                    results[t.key] = { eligible: false, plans: [] };
                }
            }
        }

        return results;
    }

    async function addWarrantyLine(plan, productLine) {
        const res = await fetch("/cart/add.js", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
                items: [
                    {
                        id: Number(plan.shopifyVariantId),
                        quantity: productLine.quantity,
                        properties: {
                            _warranty_plan_id: String(plan.planId),
                            _warranty_for_variant_id: String(productLine.variant_id),
                            _warranty_for_product_id: String(productLine.product_id),
                            _warranty_source: "cart",
                        },
                    },
                ],
            }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data?.description || data?.message || "Failed to add protection");
        }
        return data;
    }

    async function removeWarrantyLine(warrantyLine) {
        const res = await fetch("/cart/change.js", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ id: warrantyLine.key, quantity: 0 }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data?.description || data?.message || "Failed to remove protection");
        }
        return data;
    }

    async function setWarrantyQuantity(warrantyLine, quantity) {
        const res = await fetch("/cart/change.js", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ id: warrantyLine.key, quantity }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data?.description || data?.message || "Failed to sync protection quantity");
        }
        return data;
    }

    function notifyCartUpdated() {
        document.dispatchEvent(new CustomEvent("cart:refresh", { bubbles: true }));
        document.dispatchEvent(new CustomEvent("cart:updated", { bubbles: true }));
    }

    /**
     * Keeps warranty lines behaving like a normal Shopify product tied to
     * its paired product: removes a warranty line whose product was
     * removed from the cart, and keeps its quantity equal to the product's
     * quantity. Returns true if it changed anything (caller should re-fetch
     * the cart before rendering).
     */
    async function reconcileOrphanedWarranties(cart) {
        const productLines = cart.items.filter(i => !isWarrantyLine(i));
        const qtyByVariant = {};
        const presentVariants = new Set();
        productLines.forEach(line => {
            qtyByVariant[String(line.variant_id)] = line.quantity;
            presentVariants.add(String(line.variant_id));
        });

        let changed = false;
        for (const warrantyLine of cart.items.filter(isWarrantyLine)) {
            const pairedVariantId = warrantyLine.properties?._warranty_for_variant_id;
            if (!pairedVariantId || !presentVariants.has(String(pairedVariantId))) {
                try {
                    await removeWarrantyLine(warrantyLine);
                    changed = true;
                } catch (err) {
                    console.warn(
                        "[Extended Warranty] Failed to remove orphaned warranty line:",
                        err.message
                    );
                }
                continue;
            }

            const expectedQty = qtyByVariant[String(pairedVariantId)];
            if (expectedQty && warrantyLine.quantity !== expectedQty) {
                try {
                    await setWarrantyQuantity(warrantyLine, expectedQty);
                    changed = true;
                } catch (err) {
                    console.warn(
                        "[Extended Warranty] Failed to sync warranty quantity:",
                        err.message
                    );
                }
            }
        }
        return changed;
    }

    function renderGroup(group, plansData) {
        const { line, linkedWarranty } = group;
        const key = `${line.product_id}:${line.variant_id}`;
        const variantLabel =
            line.variant_title && line.variant_title !== "Default Title"
                ? ` · ${escapeHtml(line.variant_title)}`
                : "";

        if (linkedWarranty) {
            const planName = linkedWarranty.product_title || "Extended Warranty";
            return `
        <div class="wpc-cart-item" data-variant-id="${escapeHtml(line.variant_id)}">
          <div class="wpc-cart-item-product">${escapeHtml(line.product_title)}${variantLabel}</div>
          <div class="wpc-cart-linked">
            <span class="wpc-cart-linked-label">Protection added: ${escapeHtml(planName)}</span>
            <button type="button" class="wpc-remove-btn" data-action="remove-warranty" data-key="${escapeHtml(linkedWarranty.key)}">Remove</button>
          </div>
        </div>
      `;
        }

        const data = plansData[key];
        if (!data || !data.eligible || !data.plans?.length) return "";

        const cardsHtml = window.WarrantyPlanCard.renderPlanCards(data.plans, {
            groupName: `ew-cart-plan-${line.key}`,
            selectedPlanId: null,
            allowNone: true,
            noneLabel: "No thanks",
        });

        return `
      <div
        class="wpc-cart-item"
        data-variant-id="${escapeHtml(line.variant_id)}"
        data-product-id="${escapeHtml(line.product_id)}"
        data-quantity="${escapeHtml(line.quantity)}"
      >
        <div class="wpc-cart-item-product">${escapeHtml(line.product_title)}${variantLabel}</div>
        <div class="wpc-cart-item-subtitle">Add protection for this item</div>
        ${cardsHtml}
      </div>
    `;
    }

    function initBlock(container) {
        const shop = container.dataset.shop;
        if (!shop) return;

        let rendering = false;
        let pendingRerender = false;

        async function refresh() {
            if (rendering) {
                pendingRerender = true;
                return;
            }
            rendering = true;

            try {
                let cart = await getCart();

                if (!cart.items?.length) {
                    container.hidden = true;
                    container.innerHTML = "";
                    return;
                }

                const changed = await reconcileOrphanedWarranties(cart);
                if (changed) {
                    notifyCartUpdated();
                    cart = await getCart();
                }

                const groups = buildGroups(cart);
                const plansData = await fetchPlansForGroups(shop, groups);
                const groupsHtml = groups
                    .map(g => renderGroup(g, plansData))
                    .filter(Boolean)
                    .join("");

                if (!groupsHtml) {
                    container.hidden = true;
                    container.innerHTML = "";
                    return;
                }

                container.hidden = false;
                container.innerHTML = `
          <div class="wpc-cart-block">
            <h3 class="wpc-pdp-title">Product Protection</h3>
            ${groupsHtml}
          </div>
        `;
                attachHandlers(groups, plansData);
            } catch (err) {
                console.warn("[Extended Warranty] Cart block render failed:", err.message);
                container.hidden = true;
                container.innerHTML = "";
            } finally {
                rendering = false;
                if (pendingRerender) {
                    pendingRerender = false;
                    refresh();
                }
            }
        }

        function attachHandlers(groups, plansData) {
            container.querySelectorAll('[data-action="remove-warranty"]').forEach(btn => {
                btn.addEventListener("click", async () => {
                    btn.disabled = true;
                    btn.textContent = "Removing…";
                    try {
                        await removeWarrantyLine({ key: btn.dataset.key });
                        notifyCartUpdated();
                        await refresh();
                    } catch (err) {
                        console.warn("[Extended Warranty] Remove protection failed:", err.message);
                        btn.disabled = false;
                        btn.textContent = "Remove";
                    }
                });
            });

            container.querySelectorAll(".wpc-cart-item[data-product-id]").forEach(itemEl => {
                const variantId = itemEl.dataset.variantId;
                const productId = itemEl.dataset.productId;
                const key = `${productId}:${variantId}`;
                const group = groups.find(g => String(g.line.variant_id) === variantId);
                const data = plansData[key];
                if (!group || !data) return;

                itemEl.querySelectorAll('input[type="radio"]').forEach(input => {
                    input.addEventListener("change", async () => {
                        if (!input.value) return; // "No thanks" — nothing to add.

                        const plan = data.plans.find(p => String(p.planId) === input.value);
                        if (!plan) return;

                        itemEl
                            .querySelectorAll('input[type="radio"]')
                            .forEach(el => (el.disabled = true));

                        try {
                            await addWarrantyLine(plan, group.line);
                            notifyCartUpdated();
                            await refresh();
                        } catch (err) {
                            console.warn("[Extended Warranty] Add protection failed:", err.message);
                            itemEl
                                .querySelectorAll('input[type="radio"]')
                                .forEach(el => (el.disabled = false));
                            if (window.WarrantyToast?.showError) {
                                window.WarrantyToast.showError(
                                    err.message || "Could not add protection to cart."
                                );
                            }
                        }
                    });
                });
            });
        }

        refresh();

        setInterval(refresh, CART_POLL_MS);
        ["cart:refresh", "cart:updated", "cart:build", "cart:change"].forEach(evtName => {
            document.addEventListener(evtName, () => refresh());
        });
    }

    function initAll() {
        document.querySelectorAll(".wpc-cart-warranty[data-shop]").forEach(el => {
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
