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
  console.log("External Div:", externalProducts);
  const addProductBtn = document.getElementById("addProduct");

  const infoIconUrl = document.getElementById("info-icon").value;

  let retailerRequired = true;

  console.log("In js external 110");

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
  
  function getRetailerName(r,lang) {
    return r[`name_${lang}`] || r.name;
  }

  function initRetailerAutocomplete(container) {
    const input = container.querySelector("[data-retailer-autocomplete]");
    if (!input) return;

    let lang = "ja";
    if(window.Weglot){
      lang = Weglot.getCurrentLang();
    }
    const list = document.createElement("div");
    list.className = "autocomplete-results";
    input.closest(".form-input").appendChild(list);

    let timer = null;
    let cached = [];

    input.addEventListener("input", () => {
      input.dataset.valid = "";
      clearTimeout(timer);

      const q = input.value.trim();
      if (q.length < 2) {
        list.innerHTML = "";
        list.style.display = "none";
        return;
      }

      timer = setTimeout(async () => {
        const res = await fetch(
          `/apps/warranty/retailers?q=${encodeURIComponent(q)}&lang=${lang}`,
        );
        cached = await res.json();

        list.innerHTML = cached
          .map(
            (r) => `
          <div class="autocomplete-item" data-name="${getRetailerName(r, lang)}" data-name-en="${getRetailerName(r, 'en')}">
            ${getRetailerName(r, lang)}
          </div>
        `,
          )
          .join("");

        list.style.display = cached.length ? "block" : "none";
      }, 300);
    });

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

    const myProductLink = document.getElementById("my_products_link").value;
    //console.log(myProductLink);

    document.querySelectorAll(".external-products-wrapper").forEach((block) => {
      payload.products.push({
        product_id: block.querySelector("[data-autocomplete]").dataset
          .productId,
        product_name: block.querySelector("[data-autocomplete]").value,
        retailer_name: block.querySelector("[data-retailer-autocomplete]")
          .dataset.nameEn,
        purchase_date: block.querySelector("input[type=date]").value,
        serial_number: block.querySelector("[data-serial]").value.trim(),
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

      //if(!data.success){
      //const remaining = document.querySelectorAll(".external-products-wrapper");
      //const serialInput = remaining.querySelector("[data-serial]");
      //showError(serialInput, data.message);
      //}else{

      console.log("Response 22 ::", data.success, data.message);

      //}

      // if (!res.ok){
      //   throw new Error();
      // }else{
      //   console.log("Response ::", res.message, res.success);
      // }

      // const successBox = document.getElementById("successMessage");
        // if (successBox) {
        //   successBox.classList.add("show");
        // }
        console.log("outer if sucess msg", data.success);


      if (data.success === true) {

        window.scrollTo({ top: 0, behavior: "smooth" });
        console.log("In success if", data.success);

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
    } catch {
      throw new Error("Something went wrong. Please try again.");
      //alert("Something went wrong. Please try again.");
    }
  });

  /* ===============================
     INIT
  =============================== */
  //  loadStoreSettings().then(addExternalProduct);

  document.addEventListener("DOMContentLoaded", async () => {
    await loadStoreSettings(); // ensures retailerRequired is ready
    addExternalProduct(); // 🔥 FIRST PRODUCT ALWAYS RENDERS
  });

  console.log("In js external 222");

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



      // setTimeout(() => {
      //   window.location.href = myProductLink;
      // }, 8000);
