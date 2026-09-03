(() => {
  /* ===============================
     CUSTOMER NAME HANDLING
  =============================== */
  const nameInput = document.getElementById("customerName");
  if (!nameInput) return;

  if (nameInput.value.trim()) {
    nameInput.readOnly = true;
  } else {
    nameInput.readOnly = false;
    nameInput.placeholder = "Enter your full name";
  }

  const emailInput = document.getElementById("customerEmail");
  const customerIdInput = document.getElementById("customerId");

  const consent1 = document.getElementById("consentCheckbox1");
  const consent2 = document.getElementById("consentCheckbox2");

  const consentPrivacyError = document.getElementById("consentPrivacyError");
  const consentConfirmError = document.getElementById("consentConfirmError");

  const externalProducts = document.getElementById("externalProducts");
  const addProductBtn = document.getElementById("addProduct");

  const infoIconUrl = document.getElementById("info-icon").value;

  let retailerRequired = true;

  /* ===============================
     ERROR HELPERS
  =============================== */
  function showError(el, msg) {
    const err = el.closest(".form-input")?.querySelector(".field-error");
    if (err) err.textContent = msg;
    el.classList.add("has-error");
  }

  function clearError(el) {
    const err = el.closest(".form-input")?.querySelector(".field-error");
    if (err) err.textContent = "";
    el.classList.remove("has-error");
  }

  function scrollToError(el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.focus?.();
  }

  /* ===============================
     SERIAL VALIDATION
  =============================== */
  function validateSerial(input, silent = false) {
    const value = input.value.trim();

    if (!value) {
      if (!silent) showError(input, "Serial number is required");
      return false;
    }

    if (!/^[a-zA-Z0-9]+$/.test(value)) {
      if (!silent) showError(input, "Only letters and numbers allowed");
      return false;
    }

    if (value.length < 10) {
      if (!silent) showError(input, "Minimum 10 characters required");
      return false;
    }

    if (value.length > 20) {
      if (!silent) showError(input, "Maximum 20 characters allowed");
      return false;
    }

    clearError(input);
    return true;
  }

  /* ===============================
     LIVE ERROR CLEAR
  =============================== */
  document.addEventListener("input", (e) => {
    if (e.target.classList.contains("has-error")) {
      clearError(e.target);
    }
  });

  consent1?.addEventListener("change", () => {
    if (consent1.checked) consentPrivacyError.textContent = "";
  });

  consent2?.addEventListener("change", () => {
    if (consent2.checked) consentConfirmError.textContent = "";
  });

  /* ===============================
     ADD EXTERNAL PRODUCT
  =============================== */
  async function addExternalProduct() {

    const template = document.getElementById("external-product-template");
    const clone = template.content.cloneNode(true);
    const wrap = clone.querySelector(".product-block");
    const dateInput = wrap.querySelector(".purchase-date");
    if (dateInput) {
      dateInput.max = new Date().toISOString().split("T")[0];
    }
    wrap.querySelector(".remove").onclick = () => {

      wrap.remove();

      const remaining = document.querySelectorAll(".external-products-wrapper");
      const productsError = document.getElementById("externalProductsError");

      if (remaining.length === 0 && productsError) {
        productsError.textContent = "Please register at least one product.";
      }

    };

    externalProducts.appendChild(clone);

    initProductAutocomplete(wrap);
    initRetailerAutocomplete(wrap);
    initTooltipToggle(wrap);

    const serialInput = wrap.querySelector("[data-serial]");

    serialInput.addEventListener("input", () => {

      clearError(serialInput);

      if (serialInput.value.trim().length >= 10) {
        validateSerial(serialInput, true);
      }

    });

  }


  addProductBtn?.addEventListener("click", addExternalProduct);

  /* ===============================
     PRODUCT AUTOCOMPLETE
  =============================== */
  function initProductAutocomplete(container) {
    const input = container.querySelector("[data-autocomplete]");
    if (!input) return;

    const list = document.createElement("div");
    list.className = "autocomplete-results";
    input.closest(".form-input").appendChild(list);

    let timer = null;

    input.addEventListener("input", () => {
      input.dataset.productId = "";
      clearTimeout(timer);

      const q = input.value.trim();
      if (q.length < 2) {
        list.innerHTML = "";
        list.style.display = "none";
        return;
      }

      timer = setTimeout(async () => {
        const res = await fetch(
          `/apps/warranty/autocomplete/products?q=${encodeURIComponent(q)}`,
        );
        const items = await res.json();

        list.innerHTML = items
          .map(
            (p) => `
          <div class="autocomplete-item"
            data-id="${p.id}"
            data-title="${p.title}">
            ${p.title}
          </div>
        `,
          )
          .join("");

        list.style.display = items.length ? "block" : "none";
      }, 300);
    });

    list.addEventListener("click", (e) => {
      const item = e.target.closest(".autocomplete-item");
      if (!item) return;

      input.value = item.dataset.title;
      input.dataset.productId = item.dataset.id;
      list.innerHTML = "";
      list.style.display = "none";
    });
  }

  /* ===============================
     RETAILER AUTOCOMPLETE
  =============================== */

  function normalizeLangCode(lang) {
    const code = String(lang || "en").trim().split("-")[0].toLowerCase();
    return /^[a-z]{2}$/.test(code) ? code : "en";
  }

  function getRetailerSearchLang() {
    const raw =
      (window.Weglot && typeof Weglot.getCurrentLang === "function"
        ? Weglot.getCurrentLang()
        : "") ||
      document.getElementById("storefrontLocale")?.value?.trim() ||
      window.Shopify?.locale ||
      document.documentElement.lang ||
      navigator.language ||
      "en";
    return normalizeLangCode(raw);
  }

  function getRetailerDisplayName(r, lang) {
    if (normalizeLangCode(lang) === "en") {
      return r.name_en || "";
    }
    return r.name_localized || r.name_ja || r.name_en || "";
  }

  function initRetailerAutocomplete(container) {
    const input = container.querySelector("[data-retailer-autocomplete]");
    if (!input) return;

    const lang = getRetailerSearchLang();

    const list = document.createElement("div");
    list.className = "autocomplete-results";
    input.closest(".form-input").appendChild(list);

    let retailers = [];

    async function loadRetailers() {
      if (retailers.length) return;

      try {
        const res = await fetch(
          `/apps/warranty/retailers?lang=${lang}`
        );

        retailers = await res.json();
      } catch (err) {
        console.error(err);
      }
    }

    function renderRetailers(items) {
      list.innerHTML = items
        .map(
          (r) => `
          <div
            class="autocomplete-item"
            data-name="${getRetailerDisplayName(r, lang)}"
            data-name-en="${getRetailerDisplayName(r, 'en')}">
            ${getRetailerDisplayName(r, lang)}
          </div>
        `
        )
        .join("");

      list.style.display = items.length ? "block" : "none";
    }

    // Show all retailers on focus
    input.addEventListener("focus", async () => {
      input.dataset.valid = "";

      await loadRetailers();

      renderRetailers(retailers);
    });

    // Reopen dropdown when clicking the input again
    input.addEventListener("click", () => {
      if (retailers.length) {
        renderRetailers(retailers);
      }
    });

    // Filter retailers while typing
    input.addEventListener("input", () => {
      input.dataset.valid = "";

      const q = input.value.trim().toLowerCase();

      const filtered = retailers.filter((r) =>
        getRetailerDisplayName(r, lang)
          .toLowerCase()
          .includes(q)
      );

      renderRetailers(filtered);
    });

    // Select retailer
    list.addEventListener("click", (e) => {
      const item = e.target.closest(".autocomplete-item");
      if (!item) return;

      input.value = item.dataset.name;
      input.dataset.nameEn = item.dataset.nameEn;
      input.dataset.valid = "true";

      clearError(input);

      list.innerHTML = "";
      list.style.display = "none";
    });

    // Close dropdown when clicking outside
    document.addEventListener("click", (e) => {
      const isInput = e.target === input;
      const isList = list.contains(e.target);

      if (!isInput && !isList) {
        list.style.display = "none";
      }
    });
  }

  function validateDuplicateSerials(productBlocks) {
    const serialMap = {};
    let hasDuplicate = false;

    productBlocks.forEach((block) => {
      const serialInput = block.querySelector("[data-serial]");
      const value = serialInput.value.trim().toLowerCase();

      if (!value) return;

      if (serialMap[value]) {
        hasDuplicate = true;

        showError(serialInput, "This serial number is already entered above.");
        showError(
          serialMap[value],
          "This serial number is already entered below.",
        );
      } else {
        serialMap[value] = serialInput;
      }
    });

    return !hasDuplicate;
  }

  /* ===============================
   TOOLTIP CLICK TOGGLE
=============================== */
  function initTooltipToggle(container) {
    const wraps = container.querySelectorAll(".custom-toolip-wrap");

    wraps.forEach((wrap) => {
      const trigger = wrap.querySelector(".info-icon");
      if (!trigger) return;

      trigger.addEventListener("click", (e) => {
        e.stopPropagation();

        const isActive = wrap.classList.contains("active");

        // close any other open tooltips first
        document.querySelectorAll(".custom-toolip-wrap.active").forEach((w) => {
          if (w !== wrap) w.classList.remove("active");
        });

        wrap.classList.toggle("active", !isActive);
      });

      // keyboard support since it's now a role="button"
      trigger.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          trigger.click();
        }
      });
    });
  }

  // close tooltip(s) when clicking anywhere outside
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".custom-toolip-wrap")) {
      document.querySelectorAll(".custom-toolip-wrap.active").forEach((w) => {
        w.classList.remove("active");
      });
    }
  });

  /* ===============================
     EXTERNAL FLOW VALIDATION
  =============================== */
  function validateExternalFlow() {
    let valid = true;
    let firstError = null;

    const productBlocks = document.querySelectorAll(
      ".external-products-wrapper",
    );
    const productsError = document.getElementById("externalProductsError");

    /* =================================================
      ⭐ REQUIRE AT LEAST ONE PRODUCT
    ================================================= */
    if (productBlocks.length === 0) {
      if (productsError) {
        productsError.textContent = "Please register at least one product.";
      }

      valid = false;
      firstError = productsError;

      scrollToError(productsError);
      return false; // stop further validation
    } else {
      if (productsError) {
        productsError.textContent = "";
      }
    }

    productBlocks.forEach((block) => {
      const product = block.querySelector("[data-autocomplete]");
      const date = block.querySelector("input[type=date]");
      const retailer = block.querySelector("[data-retailer-autocomplete]");
      const serial = block.querySelector("[data-serial]");

      if (!product.value.trim()) {
        showError(product, "Product is required");
        valid = false;
        firstError ??= product;
      } else if (!product.dataset.productId) {
        showError(product, "Select a product from the list");
        valid = false;
        firstError ??= product;
      }

      if (!date.value) {
        showError(date, "Purchase date is required");
        valid = false;
        firstError ??= date;
      }

      if (!validateSerial(serial)) {
        valid = false;
        firstError ??= serial;
      }

      if (retailerRequired) {
        if (!retailer.value.trim()) {
          showError(retailer, "Retailer is required");
          valid = false;
          firstError ??= retailer;
        } else if (retailer.dataset.valid !== "true") {
          showError(retailer, "Select retailer from list");
          valid = false;
          firstError ??= retailer;
        }
      }
    });

    /* =================================================
      ⭐ CHECK DUPLICATE SERIAL NUMBERS
    ================================================= */
    if (!validateDuplicateSerials(productBlocks)) {
      valid = false;
      if (!firstError) {
        firstError = productBlocks[0].querySelector("[data-serial]");
      }
    }

    consentPrivacyError.textContent = "";
    consentConfirmError.textContent = "";

    if (!consent1.checked) {
      consentPrivacyError.textContent = "You must accept the privacy notice.";
      valid = false;
      firstError ??= consent1;
    }

    if (!consent2.checked) {
      consentConfirmError.textContent = "You must confirm your information.";
      valid = false;
      firstError ??= consent2;
    }

    if (!valid && firstError) scrollToError(firstError);
    return valid;
  }

  /* ===============================
     SUBMIT
  =============================== */
  document.getElementById("twsForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!validateExternalFlow()) return;

    const submitBtn = e.submitter || e.target.querySelector('[type="submit"]');
    const myProductLink = document.getElementById("my_products_link").value;

    const payload = {
      flow: "external",
      consent_privacy: consent1.checked,
      consent_confirm: consent2.checked,

      customer: {
        id: customerIdInput?.value || null,
        name: nameInput.value.trim(),
        email: emailInput.value.trim(),
      },

      products: [],
    };

    // include storefront locale for server-side email language selection
    const storefrontLocale =
      document.getElementById("storefrontLocale")?.value?.trim() ||
      document.documentElement.lang ||
      window.Shopify?.locale ||
      navigator.language ||
      "en";

    payload.locale = storefrontLocale;

    if (submitBtn) submitBtn.disabled = true;
    window.ExtendedWarrantyOffer?.showPageLoader?.("Registering your product...");

    document.querySelectorAll(".external-products-wrapper").forEach((block) => {
      const retailer = block.querySelector("[data-retailer-autocomplete]");
      payload.products.push({
        product_id: block.querySelector("[data-autocomplete]").dataset.productId,
        product_name: block.querySelector("[data-autocomplete]").value,
        retailer_name: retailer.dataset.nameEn || "",
        purchase_date: block.querySelector("input[type=date]").value,
        serial_number: block.querySelector("[data-serial]").value.trim(),
      });
    });
    //The storefront form collects product, serial number, retailer, and purchase date, then posts to /apps/warranty/register. 
    // It handles validation, duplicate serials, and consent checkboxes, showing errors and disabling the submit button during submission.
    try {
      const res = await fetch("/apps/warranty/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || data.success === false) {
        const errorMessage =
          data.message ||
          data.error ||
          (res.status >= 500
            ? "Registration failed. Please try again."
            : "Registration failed. Please check your details and try again.");

        window.WarrantyToast?.showError?.(errorMessage);

        const serialInput = document.querySelector("input[data-serial]");
        const productInput = document.querySelector("[data-autocomplete]");

        if (/serial|already been registered/i.test(errorMessage) && serialInput) {
          showError(serialInput, errorMessage);
        } else if (
          /warranty duration|not configured|not set/i.test(errorMessage) &&
          productInput
        ) {
          showError(productInput, errorMessage);
        } else if (serialInput) {
          showError(serialInput, errorMessage);
        }

        window.ExtendedWarrantyOffer?.hidePageLoader?.();
        window.ExtendedWarrantyOffer?.showRegistrationForm?.();
        if (submitBtn) submitBtn.disabled = false;
        return;
      }

      if (data.success === true) {
        window.scrollTo({ top: 0, behavior: "smooth" });

        const primary = data.registrations?.[0];
        if (primary?.registerId && window.WarrantyFlowState?.isExtendedWarrantyOfferEnabledInResponse?.(data)) {
          window.WarrantyFlowState?.savePostRegistration({
            registerId: primary.registerId,
            customerEmail: emailInput.value.trim(),
            customerName: nameInput.value.trim(),
            myProductsLink: myProductLink,
          });
        }

        window.WarrantyToast?.showSuccess("Product registered successfully");

        if (window.WarrantyFlowState?.isExtendedWarrantyOfferEnabledInResponse?.(data)) {
          window.ExtendedWarrantyOffer?.showPageLoader?.(
            "Loading extended warranty options..."
          );
        } else {
          window.ExtendedWarrantyOffer?.hidePageLoader?.();
        }

        await window.WarrantyFlowState?.handlePostRegistrationNavigation(data, {
          myProductsLink: myProductLink,
          customerEmail: emailInput.value.trim(),
          customerName: nameInput.value.trim(),
        });
      }
    } catch {
      window.ExtendedWarrantyOffer?.hidePageLoader?.();
      window.ExtendedWarrantyOffer?.showRegistrationForm?.();
      if (submitBtn) submitBtn.disabled = false;
      window.WarrantyToast?.showError?.(
        "Something went wrong. Please try again.",
      );
    }
  });

  /* ===============================
     INIT
  =============================== */
  //  loadStoreSettings().then(addExternalProduct);

  document.addEventListener("DOMContentLoaded", async () => {
    await loadStoreSettings();
    addExternalProduct();

    const myProductLink =
      document.getElementById("my_products_link")?.value || "/pages/my-products";
    const initResult = await window.WarrantyFlowState?.initRegistrationPage({
      myProductsLink: myProductLink,
    });
    if (initResult?.restored && !initResult?.redirected) {
      window.WarrantyToast?.showInfo(
        "Continue selecting your extended warranty plan."
      );
    }
  });

  async function loadStoreSettings() {
    try {
      const res = await fetch("/apps/warranty/retailerSettings");
      const data = await res.json();
      retailerRequired = !!data.retailer_required;
    } catch {
      retailerRequired = true;
    }
  }
})();
