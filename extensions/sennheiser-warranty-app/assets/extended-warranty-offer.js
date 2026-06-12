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
    }
    loader.classList.remove("hidden");
  }

  function hideLoader(section) {
    section.querySelector(".ew-page-loader")?.classList.add("hidden");
  }

  function hideFormPanel() {
    document.querySelectorAll(FORM_PANEL_SELECTOR).forEach(el => {
      el.classList.add("hidden");
    });
  }

  function showFormPanel() {
    document.querySelectorAll(FORM_PANEL_SELECTOR).forEach(el => {
      el.classList.remove("hidden");
    });
    const section = document.getElementById("ew-offer-section");
    if (section) {
      section.classList.add("hidden");
      section.innerHTML = "";
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
      window.location.href = data.checkoutUrl;
      return;
    }
    throw new Error("No checkout URL returned");
  }

  function renderOffer(offerData, options = {}) {
    const {
      myProductsLink = "/pages/my-products",
      customerEmail = "",
      customerName = "",
      onSkip,
    } = options;

    const section = document.getElementById("ew-offer-section");
    if (!section || !offerData?.registration) return false;

    hideFormPanel();
    section.classList.remove("hidden");

    const reg = offerData.registration;
    const settings = offerData.settings || {};
    const plans = offerData.plans || [];
    const currency = offerData.currency || plans[0]?.currency;

    const recommendedIndex =
      plans.length > 1 ? Math.min(1, plans.length - 1) : 0;

    const plansHtml = plans
      .map((plan, index) => {
        const isRecommended = index === recommendedIndex && plans.length > 1;
        return `
          <label class="ew-plan-option ${isRecommended ? "ew-plan-recommended" : ""}">
            <input type="radio" name="ew_plan" value="${plan.planId}" ${
              index === recommendedIndex ? "checked" : ""
            } />
            <div class="ew-plan-option-inner">
              ${
                isRecommended
                  ? '<span class="ew-plan-badge">Most popular</span>'
                  : ""
              }
              <div class="ew-plan-option-header">
                <span class="ew-plan-name">${escapeHtml(plan.planName)}</span>
                <span class="ew-plan-price">${formatPrice(plan.price, plan.currency || currency)}</span>
              </div>
              <ul class="ew-plan-features">
                <li>${plan.durationMonths} months extended coverage</li>
                ${
                  plan.extendedWarrantyStartDate && plan.extendedWarrantyEndDate
                    ? `<li>Coverage: ${formatDate(plan.extendedWarrantyStartDate)} – ${formatDate(plan.extendedWarrantyEndDate)}</li>`
                    : "<li>Starts after standard warranty</li>"
                }
                <li>Instant activation after payment</li>
              </ul>
            </div>
          </label>
        `;
      })
      .join("");

    section.innerHTML = `
      <div class="ew-offer-shell">
        <div class="ew-offer-grid">
          <aside class="ew-offer-sidebar">
            <h2 class="ew-offer-title">Extended Warranty</h2>
            <div class="ew-product-card">
              <p class="ew-product-label">Registered product</p>
              <h3>${escapeHtml(reg.productName || "Product")}</h3>
              <dl class="ew-meta-list">
                <div><dt>Serial</dt><dd>${escapeHtml(reg.serialNumber || "-")}</dd></div>
                <div><dt>Standard warranty ends</dt><dd>${formatDate(reg.standardWarrantyEnd)}</dd></div>
                ${reg.sku ? `<div><dt>SKU</dt><dd>${escapeHtml(reg.sku)}</dd></div>` : ""}
              </dl>
            </div>
            ${
              settings.coverageText
                ? `<div class="ew-coverage-box"><h4>What's covered</h4><p>${escapeHtml(settings.coverageText)}</p></div>`
                : ""
            }
          </aside>

          <main class="ew-offer-main">
            <h3 class="ew-choose-title">Choose your plan</h3>
            <div class="ew-plan-grid">${plansHtml || "<p>No plans available.</p>"}</div>
            ${
              settings.termsUrl
                ? `<p class="ew-terms">By continuing you agree to the <a href="${escapeHtml(settings.termsUrl)}" target="_blank" rel="noopener">Terms &amp; Conditions</a>.</p>`
                : ""
            }
          </main>
        </div>

        <div class="ew-sticky-actions">
          <button type="button" class="btn bordered-btn" id="ew-skip-btn">Skip for now</button>
          <button type="button" class="btn ew-primary-btn" id="ew-purchase-btn" ${
            plans.length ? "" : "disabled"
          }>Continue to checkout</button>
        </div>
      </div>
    `;

    section.querySelector("#ew-skip-btn")?.addEventListener("click", () => {
      if (typeof onSkip === "function") onSkip();
      else window.location.href = myProductsLink;
    });

    section.querySelector("#ew-purchase-btn")?.addEventListener("click", async () => {
      const selected = section.querySelector('input[name="ew_plan"]:checked');
      if (!selected) {
        alert("Please select a plan.");
        return;
      }

      const btn = section.querySelector("#ew-purchase-btn");
      btn.disabled = true;
      showLoader(section, "Preparing secure checkout...");

      try {
        await purchasePlan(
          reg.registerId,
          Number(selected.value),
          customerEmail,
          customerName
        );
      } catch (err) {
        hideLoader(section);
        alert(err.message || "Unable to start checkout.");
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
  };
})();
