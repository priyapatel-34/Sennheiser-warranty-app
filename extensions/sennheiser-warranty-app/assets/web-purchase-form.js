(() => {
  /* ---------- CUSTOMER NAME READONLY ---------- */
  const nameInput = document.getElementById("customerName");
  if (nameInput && nameInput.value.trim()) {
    nameInput.readOnly = true;
  }

  const orderNumber = document.getElementById("orderNumber");
  const orderDate = document.getElementById("orderDate");
  const shopifyProducts = document.getElementById("shopifyProducts");

  const consent1 = document.getElementById("consentCheckbox1");
  const consent2 = document.getElementById("consentCheckbox2");

  const consentPrivacyError = document.getElementById("consentPrivacyError");
  const consentConfirmError = document.getElementById("consentConfirmError");

  const infoIconUrl = document.getElementById("info-icon").value;

  /* ---------- SCROLL HELPER ---------- */
  function scrollToError(el) {
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /* ---------- LOAD SHOPIFY ORDER ---------- */
  async function loadOrders() {
    const contextRaw = sessionStorage.getItem("warranty_registration_context");
    if (!contextRaw)
      return console.error("Missing warranty registration context");

    const { order_id, product_id } = JSON.parse(contextRaw);
    if (!order_id || !product_id)
      return console.error("Invalid registration context");

    const payload = new URLSearchParams({ order_id, product_id });

    const response = await fetch("/apps/warranty/orders", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: payload.toString(),
    });

    if (!response.ok) return console.error("Failed to load order data");

    const data = await response.json();

    orderNumber.value = data.order_id.split("/").pop();
    orderDate.value = data.purchase_date;

    shopifyProducts.innerHTML = `
      <div class="product-block">
        <span class="product-name">
          ${data.product.displayName}
          (SKU: ${data.product.displaySku})
        </span>

        <div class="form-control form-input">
          <div class="label-with-icon-wrap">
            <label>Serial Number</label>
            <div class="custom-toolip-wrap">
              <span class="info-icon" aria-label="Where to find serial number">
                <img src="${infoIconUrl}">
              </span>
              <div class="tooltip">
                 <span>The serial number can be found on the product packaging, on the product itself, or inside the charging case (if applicable).</span>
              </div>
            </div>
          </div>

          <input 
            data-serial
            data-line-item-id="${data.product.line_item_id}"
            data-product-id="${data.product.product_id}"
          />

          <div class="field-error"></div>
        </div>
      </div>
    `;

    attachLiveValidation();
  }

  loadOrders();

  /* ---------- ERROR HELPERS ---------- */
  function showError(el, msg) {
    const group = el.closest(".form-input");
    const err = group?.querySelector(".field-error");
    if (err) err.textContent = msg;
    el.classList.add("has-error");
  }

  function clearError(el) {
    const group = el.closest(".form-input");
    const err = group?.querySelector(".field-error");
    if (err) err.textContent = "";
    el.classList.remove("has-error");
  }

  /* ---------- SERIAL VALIDATION LOGIC ---------- */
  function validateSerial(input, silent = false) {
    const value = input.value.trim();

    if (!value) {
      if (!silent) showError(input, "Serial number is required");
      return false;
    }

    if (!/^[a-zA-Z0-9]+$/.test(value)) {
      if (!silent)
        showError(input, "Serial number must contain only letters and numbers");
      return false;
    }

    if (value.length < 10) {
      if (!silent)
        showError(input, "Serial number must be at least 10 characters");
      return false;
    }

    if (value.length > 20) {
      if (!silent)
        showError(input, "Serial number must not exceed 20 characters");
      return false;
    }

    clearError(input);
    return true;
  }

  /* ---------- LIVE VALIDATION ---------- */
  function attachLiveValidation() {
    document.querySelectorAll("[data-serial]").forEach((input) => {
      input.addEventListener("input", () => {
        // Clear error immediately while typing
        clearError(input);

        // Optional soft validation after some typing
        if (input.value.trim().length >= 10) {
          validateSerial(input, true);
        }
      });
    });
  }

  consent1?.addEventListener("change", () => {
    if (consent1.checked) consentPrivacyError.textContent = "";
  });

  consent2?.addEventListener("change", () => {
    if (consent2.checked) consentConfirmError.textContent = "";
  });

  /* ---------- FINAL SUBMIT VALIDATION ---------- */
  function validateShopifyFlow() {
    let valid = true;
    let firstError = null;

    document.querySelectorAll("[data-serial]").forEach((input) => {
      if (!validateSerial(input)) {
        valid = false;
        firstError ??= input;
      }
    });

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

  /* ---------- SUBMIT ---------- *
  document.getElementById("twsForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    if (!validateShopifyFlow()) return;

    const serialInput = document.querySelector("[data-serial]");

    const payload = {
      customer_id: document.getElementById("customerId").value,
      order_number: orderNumber.value,
      purchase_date: orderDate.value,
      product_id: serialInput.dataset.productId,
      line_item_id: serialInput.dataset.lineItemId,
      serial_number: serialInput.value.trim(),
      consent_privacy: consent1.checked,
      consent_confirm: consent2.checked
    };

    try {
      const res = await fetch("/apps/warranty/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error();
      window.location.href = "/pages/my-products";

    } catch {
      alert("Something went wrong. Please try again.");
    }
  });*/

  document.getElementById("twsForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();

    /* 🔴 VALIDATION MUST RUN HERE */
    const isValid = validateShopifyFlow();
    if (!isValid) return;

    /* 🟢 ONLY AFTER VALIDATION PASSES */
    const customerId = document.getElementById("customerId")?.value || null;

    const nameInput = document.getElementById("customerName");
    const emailInput = document.getElementById("customerEmail");
    const myProductLink = document.getElementById("my_products_link").value;

    const payload = {
      flow: "shopify",

      consent_privacy: consent1.checked,
      consent_confirm: consent2.checked,

      customer: {
        id: customerId,
        name: nameInput?.value?.trim() || "",
        email: emailInput?.value?.trim() || "",
      },

      products: [],
    };

    const purchaseDate = orderDate.value;

    document.querySelectorAll("[data-serial]").forEach((input) => {
      payload.products.push({
        shopify_order_id: orderNumber.value,
        shopify_line_item_id: input.dataset.lineItemId,
        product_id: input.dataset.productId || null,

        product_name:
          input.closest(".product-block")?.querySelector("strong")?.innerText ||
          "",

        purchase_date: purchaseDate,
        serial_number: input.value.trim(),
      });
    });

    try {
      const res = await fetch("/apps/warranty/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      console.log("Response ::", data.success, data.message);

      if (!res.ok || data.success === false) {
        const serialInput = document.querySelector("input[data-serial]");
        if (serialInput) {
          showError(
            serialInput,
            data.message || "Product Serial Number already registered.",
          );
        }
        return;
      }
      //if (!res.ok) throw new Error();
              console.log("outer if sucess msg", data.success);

      if (data.success === true) {
                console.log("outer if sucess msg", data.success);

        // const successBox = document.getElementById("successMessage");
        // if (successBox) {
        //   successBox.classList.add("show");
        // }

        window.scrollTo({ top: 0, behavior: "smooth" });

        const result = confirm("Thank you. Product Registered Successfully!");
        if (result) {
          window.location.href = myProductLink;
        }
        else {

          /* ===============================
            CLEAR INPUT FIELDS (UPDATED)
          =============================== */

          document.querySelectorAll(".external-products-wrapper").forEach(block => {

            const productInput = block.querySelector("[data-autocomplete]");
            const retailerInput = block.querySelector("[data-retailer-autocomplete]");
            const dateInput = block.querySelector("input[type=date]");
            const serialInput = block.querySelector("[data-serial]");

            if (productInput) {
              productInput.value = "";
              productInput.dataset.productId = "";
            }

            if (retailerInput) {
              retailerInput.value = "";
              retailerInput.dataset.valid = "";
            }

            if (dateInput) {
              dateInput.value = "";
            }

            if (serialInput) {
              serialInput.value = "";
            }

            if (consent1) consent1.checked = false;
            if (consent2) consent2.checked = false;

          });

        }

      }
      // setTimeout(() => {
      //   window.location.href = myProductLink;
      // }, 8000);
      
    } catch {
      alert("Something went wrong. Please try again.");
    }
  });
})();
