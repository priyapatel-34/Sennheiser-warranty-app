/**
 * Shared "Plan Card" component for the Extended Warranty PDP + Cart upsell.
 *
 * Pure rendering helpers only — no business logic, no API calls. Both
 * `pdp-warranty.js` and `cart-warranty.js` use this single implementation
 * so the plan card markup/behaviour never has to be duplicated across the
 * two surfaces. Completely independent from the existing post-registration
 * offer screen (`extended-warranty-offer.js`) — nothing here is shared with
 * or modifies that file, so the current registration flow is unaffected.
 */
(() => {
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

    function sortPlansByDuration(plans) {
        return [...(plans || [])].sort(
            (a, b) => (a.durationMonths || 0) - (b.durationMonths || 0)
        );
    }

    /**
     * @param {Array} plans - [{ planId, planName, price, currency, coverageText, badgeLabel, termsUrl, shopifyVariantId }]
     * @param {Object} options
     * @param {string} options.groupName - unique radio group name (scoped per product/variant instance)
     * @param {string|number|null} [options.selectedPlanId]
     * @param {boolean} [options.allowNone=true] - render a "No thanks" option alongside the plans
     * @param {string} [options.noneLabel="No thanks"]
     */
    function renderPlanCards(plans, options = {}) {
        const {
            groupName,
            selectedPlanId = null,
            allowNone = true,
            noneLabel = "No thanks",
        } = options;

        const sorted = sortPlansByDuration(plans);
        const termsUrl = sorted.find(p => p.termsUrl)?.termsUrl;

        const cardsHtml = sorted
            .map(plan => {
                const isChecked = String(selectedPlanId) === String(plan.planId);
                return `
        <label class="wpc-card${isChecked ? " wpc-card--selected" : ""}">
          <input
            type="radio"
            name="${escapeHtml(groupName)}"
            value="${escapeHtml(plan.planId)}"
            data-wpc-variant-id="${escapeHtml(plan.shopifyVariantId || "")}"
            class="wpc-radio"
            ${isChecked ? "checked" : ""}
          />
          <span class="wpc-card-body">
            ${plan.badgeLabel
                        ? `<span class="wpc-badge">${escapeHtml(plan.badgeLabel)}</span>`
                        : ""
                    }
            <span class="wpc-card-top">
              <span class="wpc-plan-name">${escapeHtml(plan.planName)}</span>
              <span class="wpc-plan-price">${escapeHtml(
                        formatPrice(plan.price, plan.currency)
                    )}</span>
            </span>
            ${plan.coverageText
                        ? `<span class="wpc-coverage">${escapeHtml(plan.coverageText)}</span>`
                        : ""
                    }
          </span>
        </label>
      `;
            })
            .join("");

        const noneHtml = allowNone
            ? `
        <label class="wpc-card wpc-card--none${selectedPlanId ? "" : " wpc-card--selected"}">
          <input
            type="radio"
            name="${escapeHtml(groupName)}"
            value=""
            class="wpc-radio"
            ${selectedPlanId ? "" : "checked"}
          />
          <span class="wpc-card-body">
            <span class="wpc-plan-name">${escapeHtml(noneLabel)}</span>
          </span>
        </label>
      `
            : "";

        return `
      <div class="wpc-plan-grid">
        ${cardsHtml}
        ${noneHtml}
      </div>
      ${termsUrl
                ? `<p class="wpc-terms">By adding protection you agree to the <a href="${escapeHtml(
                    termsUrl
                )}" target="_blank" rel="noopener">Terms &amp; Conditions</a>.</p>`
                : ""
            }
    `;
    }

    window.WarrantyPlanCard = {
        escapeHtml,
        formatPrice,
        sortPlansByDuration,
        renderPlanCards,
    };
})();
