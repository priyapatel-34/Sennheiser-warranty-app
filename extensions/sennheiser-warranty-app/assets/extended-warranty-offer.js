(() => {
    const FORM_PANEL_SELECTOR = ".ew-registration-form-panel";

    function escapeHtml(str) {
        if (str == null || str === "") return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function getLocale() {
        return document.documentElement.lang || navigator.language || undefined;
    }

    function formatDate(dateStr) {
        if (!dateStr) return "";
        const d = new Date(dateStr);
        if (Number.isNaN(d.getTime())) return "";
        return d.toLocaleDateString(getLocale(), {
            day: "2-digit",
            month: "short",
            year: "numeric",
        });
    }

    function formatPrice(price, currency) {
        if (price == null || price === "") return "";
        try {
            return new Intl.NumberFormat(getLocale(), {
                style: "currency",
                currency: currency || "USD",
            }).format(Number(price));
        } catch {
            return `${Number(price).toFixed(2)} ${currency || ""}`.trim();
        }
    }

    function showLoader(section, message) {
        let loader = section.querySelector(".ew-page-loader");
        if (!loader) {
            loader = document.createElement("div");
            loader.className = "ew-page-loader";
            loader.innerHTML = `
          <div class="ew-loader-spinner"></div>
          <p class="ew-loader-text">${escapeHtml(message || "Loading...")}</p>
        `;
            section.appendChild(loader);
        } else {
            const textEl = loader.querySelector(".ew-loader-text");
            if (textEl) {
                textEl.textContent = message || "Loading...";
            }
        }
        loader.classList.remove("hidden");
    }

    function hideLoader(section) {
        section?.querySelector(".ew-page-loader")?.classList.add("hidden");
    }

    function getOfferSection() {
        return document.getElementById("ew-offer-section");
    }

    function getLoaderOverlay() {
        return document.getElementById("ew-page-loader-overlay");
    }

    function ensureOfferDom() {
        let section = getOfferSection();
        if (!section) {
            section = document.createElement("div");
            section.id = "ew-offer-section";
            section.className = "ew-offer-section hidden";
            const host = document.querySelector(".register-warranty-form-section") || document.body;
            host.appendChild(section);
        }

        let overlay = getLoaderOverlay();
        if (!overlay) {
            overlay = document.createElement("div");
            overlay.id = "ew-page-loader-overlay";
            overlay.className = "ew-page-loader-overlay";
            overlay.hidden = true;
            overlay.innerHTML = `
                <div class="ew-page-loader">
                    <div class="ew-loader-spinner"></div>
                    <p class="ew-loader-text">Loading extended warranty options...</p>
                </div>
            `;
            const host = document.querySelector(".register-warranty-form-section") || document.body;
            host.appendChild(overlay);
        }

        return { section, overlay };
    }

    function setOverlayMessage(message) {
        const overlay = getLoaderOverlay();
        const textEl = overlay?.querySelector(".ew-loader-text");
        if (textEl) {
            textEl.textContent = message || "Loading extended warranty options...";
        }
    }

    function showPageLoader(message) {
        hideFormPanel();
        document.documentElement.classList.remove("ew-transition-pending");

        const { overlay } = ensureOfferDom();
        if (!overlay) return false;

        setOverlayMessage(message);
        overlay.hidden = false;
        return true;
    }

    function hidePageLoader() {
        document.documentElement.classList.remove("ew-transition-pending");

        const { section, overlay } = ensureOfferDom();
        if (overlay) {
            overlay.hidden = true;
        }

        if (section) {
            hideLoader(section);
            section.classList.add("hidden");
        }
    }

    function hideFormPanel() {
        document.querySelectorAll(FORM_PANEL_SELECTOR).forEach(el => {
            el.classList.add("hidden");
        });
    }

    function showFormPanel() {
        document.documentElement.classList.remove("ew-transition-pending");
        const overlay = getLoaderOverlay();
        if (overlay) {
            overlay.hidden = true;
        }

        document.querySelectorAll(FORM_PANEL_SELECTOR).forEach(el => {
            el.classList.remove("hidden");
        });
        document
            .querySelector(".register-warranty-form-section")
            ?.classList.remove("ew-offer-active");
        const section = document.getElementById("ew-offer-section");
        if (section) {
            section.classList.add("hidden");
            section.innerHTML = "";
        }
    }

    async function cancelPendingCheckout(registerId) {
        if (!registerId) return;
        try {
            await fetch("/apps/warranty/extended-warranty/cancel-pending", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ register_id: registerId }),
            });
        } catch {
            // Non-blocking cleanup when customer skips the offer.
        }
    }

    async function purchasePlan(registerId, planId, customerEmail, customerName) {
        const res = await fetch("/apps/warranty/extended-warranty/checkout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                register_id: registerId,
                plan_id: planId,
                customer_email: customerEmail,
                customer_name: customerName,
            }),
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
            throw new Error(data.error || "Checkout failed");
        }
        if (data.checkoutUrl) {
            window.location.replace(data.checkoutUrl);
            return;
        }
        throw new Error("No checkout URL returned");
    }

    function sortPlansByDuration(plans) {
        return [...plans].sort(
            (a, b) =>
                (a.durationMonths || (a.durationYears || 0) * 12) -
                (b.durationMonths || (b.durationYears || 0) * 12)
        );
    }

    function isTwoYearPlan(plan) {
        return (
            plan.durationMonths === 24 ||
            plan.durationYears === 2 ||
            /\+?\s*2\s*(yr|year)/i.test(plan.planName || "")
        );
    }

    const EXTENSION_OFFER_EXPIRY_LABEL_MAX_DAYS = 10;

    function formatExtensionOfferExpiryLabel(purchaseWindow) {
        if (!purchaseWindow?.configured) return null;

        if (
            !purchaseWindow.allowed &&
            purchaseWindow.reason === "purchase_window_expired"
        ) {
            return { label: "Extension Offer Expired", expired: true };
        }

        const remaining = Number(purchaseWindow.daysRemaining);
        if (!Number.isFinite(remaining)) return null;

        if (remaining > EXTENSION_OFFER_EXPIRY_LABEL_MAX_DAYS) return null;

        if (remaining === 0) {
            return { label: "Offer Expires Today", expired: false };
        }
        if (remaining === 1) {
            return { label: "Extension Offer Expires Tomorrow", expired: false };
        }
        return {
            label: `Extension Offer Expires in ${remaining} Days`,
            expired: false,
        };
    }

    function getDefaultPlanIndex(plans) {
        const twoYearIdx = plans.findIndex(isTwoYearPlan);
        return twoYearIdx >= 0 ? twoYearIdx : 0;
    }

    function renderOffer(offerData, options = {}) {
        const {
            myProductsLink = "/pages/my-products",
            customerEmail = "",
            customerName = "",
            onSkip,
        } = options;

        const { section } = ensureOfferDom();
        if (!section || !offerData?.registration) return false;

        document.documentElement.classList.remove("ew-transition-pending");
        hidePageLoader();
        hideFormPanel();
        section.classList.remove("hidden");
        document
            .querySelector(".register-warranty-form-section")
            ?.classList.add("ew-offer-active");

        const reg = offerData.registration;
        const settings = offerData.settings || {};
        const purchaseWindow = offerData.purchaseWindow || {};
        const plans = sortPlansByDuration(offerData.plans || []);
        const currency = offerData.currency || plans[0]?.currency;
        const productImageUrl = reg.productImageUrl || null;
        const expiryBadge = formatExtensionOfferExpiryLabel(purchaseWindow);
        const isOfferExpired =
            Boolean(purchaseWindow?.configured) &&
            (!purchaseWindow.allowed ||
                purchaseWindow.reason === "purchase_window_expired");
        const expiryBadgeHtml = isOfferExpired
            ? `<span class="badge ew-badge-expired">${escapeHtml("Extension Offer Expired")}</span>`
            : expiryBadge
                ? `<span class="badge${expiryBadge.expired ? " ew-badge-expired" : ""}">${escapeHtml(expiryBadge.label)}</span>`
                : "";

        const coverageLines = (settings.coverageText || "")
            .split("\n")
            .map(line => line.trim())
            .filter(Boolean);

        const coverageHtml = coverageLines.length
            ? `<ul>${coverageLines.map(line => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`
            : "";

        const defaultPlanIndex = getDefaultPlanIndex(plans);

        const plansHtml = plans
            .map((plan, index) => {
                const isDefaultSelected = index === defaultPlanIndex;
                const badgeLabel = plan.badgeLabel || null;
                const showBadge = Boolean(badgeLabel);
                return `
            <label class="ew-plan-option">
      <input type="radio" name="ew_plan" value="${plan.planId}" ${isDefaultSelected ? "checked" : ""
                    } />                        
      <div class="ew-plan-option-inner">
          ${showBadge
                        ? `<span class="ew-plan-badge">${escapeHtml(badgeLabel)}</span>`
                        : ""
                    }
          <span class="ew-plan-name">${escapeHtml(plan.planName)}</span>
          <div class="ew-plan-meta-row">
              <ul class="ew-plan-features">
                  ${plan.extendedWarrantyStartDate && plan.extendedWarrantyEndDate
                        ? `<li>Coverage: ${formatDate(plan.extendedWarrantyStartDate)} – ${formatDate(plan.extendedWarrantyEndDate)}</li>`
                        : "<li>Starts after standard warranty</li>"
                    }
              </ul>
              <span class="ew-plan-price">${formatPrice(plan.price, plan.currency || currency)}</span>
          </div>
      </div>
  </label>
          `;
            })
            .join("");

        section.innerHTML = `
        <section class="product-outer-wrapper ew-outer-wrapper">
            <div class="upper-block">
                <div class="title-wrapper">
                    <h2>Extended Warranty</h2>
                    <p class="ew-subtitle">
                        Protect your ${escapeHtml(reg.productName || "product")} with extended coverage that begins when your standard warranty ends.
                    </p>
                </div>
                <p class="ew-section-label">Registered Product</p>
                <div class="ew-product-card">
                    ${productImageUrl
                ? `<div class="ew-product-image-wrap"><img class="ew-product-image" src="${escapeHtml(productImageUrl)}" alt="${escapeHtml(reg.productName || "Product")}" loading="lazy" /></div>`
                : ""
            }
                    <div class="ew-product-info">
                        <div class="title-with-badge">
                          <h3>${escapeHtml(reg.productName || "Product")}</h3>
                          ${expiryBadgeHtml}
                        </div>
                        <dl class="ew-meta-list">
                            <div><dt>Serial number</dt><dd>${escapeHtml(reg.serialNumber || "-")}</dd></div>
                            <div><dt>Standard warranty ends</dt><dd>${formatDate(reg.standardWarrantyEnd)}</dd></div>
                            ${reg.sku ? `<div><dt>SKU</dt><dd>${escapeHtml(reg.sku)}</dd></div>` : ""}
                        </dl>
                    </div>
                </div>
            </div>
  
            <div class="ew-offer-grid${isOfferExpired ? " ew-offer-expired" : ""}">
                ${coverageHtml
                ? `<div class="ew-coverage-box">
                    <h4 class="ew-section-label">What’s Covered</h4>
                    ${coverageHtml}
                </div>`
                : ""
            }
                ${isOfferExpired
                ? `<div class="ew-expired-message">
              <p>The extended warranty purchase window for this product has closed.</p>
              <button type="button" class="btn bordered-btn" id="ew-skip-btn">Back to My Products</button>
            </div>`
                : `
                <div class="divider"></div>
                <div class="ew-plan-panel">
                    <div class="upper-block">
                        <p class="ew-section-label">Choose Your Plan</p>
                        <div class="ew-plan-grid">${plansHtml || "<p>No plans available.</p>"}</div>
                    </div>
                    <div class="lower-block">
                        ${settings.termsUrl
                    ? `<p class="ew-terms">By continuing you agree to the <a href="${escapeHtml(settings.termsUrl)}" target="_blank" rel="noopener">Terms &amp; Conditions</a>.</p>`
                    : ""
                }
                        <div class="ew-actions-row">
                            <button type="button" class="btn bordered-btn" id="ew-skip-btn">Skip for now</button>
                            <button type="button" class="btn btn-primary ew-primary-btn" id="ew-purchase-btn" ${plans.length ? "" : "disabled"
                }>Continue to checkout</button>
                        </div>
                    </div>
                </div>`
            }
            </div>
        </section>
      `;

        section.querySelector("#ew-skip-btn")?.addEventListener("click", async () => {
            await cancelPendingCheckout(reg.registerId);
            if (typeof onSkip === "function") {
                onSkip();
                return;
            }
            window.WarrantyToast?.queueSuccess?.(
                window.WarrantyFlowState?.TOAST?.skipEw ||
                "Registration complete. You can extend your warranty from My Products."
            );
            window.WarrantyFlowState?.clearPostRegistration?.();
            window.location.replace(myProductsLink);
        });

        section.querySelector("#ew-purchase-btn")?.addEventListener("click", async () => {
            const selected = section.querySelector('input[name="ew_plan"]:checked');
            if (!selected) {
                window.WarrantyToast?.showWarning?.("Please select a plan.");
                return;
            }

            const btn = section.querySelector("#ew-purchase-btn");
            btn.disabled = true;
            showLoader(section, "Preparing secure checkout...");

            try {
                window.WarrantyToast?.showInfo?.(
                    window.WarrantyFlowState?.TOAST?.checkoutRedirect ||
                    "Redirecting to secure checkout..."
                );
                window.WarrantyFlowState?.markCheckoutStarted?.({
                    registerId: reg.registerId,
                    myProductsLink,
                });
                await purchasePlan(
                    reg.registerId,
                    Number(selected.value),
                    customerEmail,
                    customerName
                );
            } catch (err) {
                hideLoader(section);
                window.WarrantyToast?.showError?.(
                    err.message ||
                    window.WarrantyFlowState?.TOAST?.checkoutFailed ||
                    "Unable to start checkout."
                );
                btn.disabled = false;
            }
        });

        section.scrollIntoView({ behavior: "smooth", block: "start" });
        return true;
    }

    window.ExtendedWarrantyOffer = {
        renderOffer,
        hideOffer: showFormPanel,
        showRegistrationForm: showFormPanel,
        purchasePlan,
        showPageLoader,
        hidePageLoader,
    };
})();
