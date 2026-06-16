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
    document
      .querySelector(".register-warranty-form-section")
      ?.classList.remove("ew-offer-active");
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
    document
      .querySelector(".register-warranty-form-section")
      ?.classList.add("ew-offer-active");

    const reg = offerData.registration;
    const settings = offerData.settings || {};
    const plans = offerData.plans || [];
    const currency = offerData.currency || plans[0]?.currency;

    const coverageLines = (settings.coverageText || "")
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean);

    const coverageHtml = coverageLines.length
      ? `<ul>${coverageLines.map(line => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`
      : `<p>${escapeHtml("Extended protection after your standard warranty ends.")}</p>`;

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
                <li>Coverage begins when standard warranty ends</li>
              </ul>
            </div>
          </label>
        `;
      })
      .join("");

    section.innerHTML = `
      <section class="product-outer-wrapper ew-outer-wrapper">
        <div class="title-wrapper">
          <h2>Extended Warranty</h2>
        </div>
        <p class="ew-subtitle">
          Protect your ${escapeHtml(reg.productName || "product")} with extended coverage that begins when your standard warranty ends.
        </p>

        <div class="ew-offer-grid">
          <aside class="ew-offer-sidebar">
            <p class="ew-section-label">Registered product</p>
            <div class="ew-product-card">
              <h3>${escapeHtml(reg.productName || "Product")}</h3>
              <dl class="ew-meta-list">
                <div><dt>Serial number</dt><dd>${escapeHtml(reg.serialNumber || "-")}</dd></div>
                <div><dt>Standard warranty ends</dt><dd>${formatDate(reg.standardWarrantyEnd)}</dd></div>
                ${reg.sku ? `<div><dt>SKU</dt><dd>${escapeHtml(reg.sku)}</dd></div>` : ""}
              </dl>
            </div>
            <div class="ew-coverage-box">
              <h4>What's covered</h4>
              ${coverageHtml}
            </div>
          </aside>

          <div class="ew-plan-panel">
            <p class="ew-section-label">Choose your plan</p>
            <div class="ew-plan-grid">${plansHtml || "<p>No plans available.</p>"}</div>
            ${
              settings.termsUrl
                ? `<p class="ew-terms">By continuing you agree to the <a href="${escapeHtml(settings.termsUrl)}" target="_blank" rel="noopener">Terms &amp; Conditions</a>.</p>`
                : ""
            }
          </div>
        </div>

        <div class="ew-actions-row">
          <button type="button" class="btn bordered-btn" id="ew-skip-btn">Skip for now</button>
          <button type="button" class="btn ew-primary-btn" id="ew-purchase-btn" ${
            plans.length ? "" : "disabled"
          }>Continue to checkout</button>
        </div>
      </section>
    `;

    section.querySelector("#ew-skip-btn")?.addEventListener("click", () => {
      window.WarrantyFlowState?.clearPostRegistration();
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
        window.WarrantyFlowState?.clearPostRegistration();
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
