function formatDate(dateStr) {
  if (!dateStr) return "";

  const [year, month, day] = dateStr.split("T")[0].split("-");
  const date = new Date(year, month - 1, day);

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getWarrantyStatus(warrantyEnd) {
  if (!warrantyEnd) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const endDate = new Date(warrantyEnd);
  endDate.setHours(0, 0, 0, 0);

  const icons = window.WARRANTY_ICONS || {};

  if (endDate < today) {
    return {
      type: "expired",
      label: "Expired",
      icon: icons.expired,
    };
  }

  const twoMonthsFromNow = new Date(today);
  twoMonthsFromNow.setMonth(twoMonthsFromNow.getMonth() + 2);

  if (endDate <= twoMonthsFromNow) {
    return {
      type: "expiring",
      label: "Expiring Soon",
      icon: icons.expiring,
    };
  }

  return {
    type: "active",
    label: "Active Warranty",
    icon: icons.active,
  };
}

function hasPurchasedExtendedWarranty(product) {
  const ew = product?.extended_warranty;
  return (
    ew?.status === "active" ||
    (ew?.displayStatus && ew.displayStatus !== "Not Purchased" && ew.displayStatus !== "Pending Payment")
  );
}

function canShowExtendWarrantyButton(product) {
  return Boolean(product?.can_extend_warranty) && !hasPurchasedExtendedWarranty(product);
}

function isPendingExtendedWarranty(product) {
  const ew = product?.extended_warranty;
  return (
    ew?.status === "pending_payment" ||
    ew?.displayStatus === "Pending Payment"
  );
}

function savePostRegistrationForResume(registerId, myProductsLink) {
  const customerEmail =
    document.querySelector(".mp-user-text p")?.textContent?.trim() || "";
  sessionStorage.setItem(
    "warranty_post_registration_state",
    JSON.stringify({
      registerId: Number(registerId),
      customerEmail,
      myProductsLink: myProductsLink || window.location.pathname,
      savedAt: Date.now(),
    })
  );
}

(async () => {
  const rootWarpper = document.getElementById("mp-app-root");
  const registerLink = rootWarpper.dataset.registerLink;
  const web_register_label =
    rootWarpper.dataset.webRegisterLabel || "+ Register product";

  const web_register_link = rootWarpper.dataset.webRegisterLink || registerLink;
  const externalBTN = document.getElementById("mp-external-register-btn");
  const external_register_link = externalBTN?.dataset.externalRegisterLink || web_register_link;

  function resumeExtendedWarrantyPayment(registerId, source) {
    if (!registerId) return;
    savePostRegistrationForResume(registerId, window.location.pathname);
    const targetLink =
      source === "external" ? external_register_link : web_register_link;
    if (targetLink) {
      window.location.href = targetLink;
    }
  }

  console.log("External Link : ", externalBTN, external_register_link);



  rootWarpper.classList.remove("breadcrumb-mobile");

  const track = document.getElementById("mp-track");
  const sliderWrapper = document.querySelector(".slider-wrapper");
  const productsSection = document.getElementById("mp-products-section");
  const detailSection = document.getElementById("mp-product-detail");

  if (!track) return;

  function showProductsLoader() {
    if (!productsSection) return;
    let loader = productsSection.querySelector(".mp-products-loader");
    if (!loader) {
      loader = document.createElement("div");
      loader.className = "mp-products-loader";
      loader.innerHTML = `
        <div class="mp-loader-spinner"></div>
        <p class="mp-loader-text">Loading your products...</p>
      `;
      productsSection.appendChild(loader);
    }
    loader.classList.remove("hidden");
    sliderWrapper?.classList.add("hidden");
  }

  function hideProductsLoader() {
    productsSection?.querySelector(".mp-products-loader")?.classList.add("hidden");
  }

  showProductsLoader();

  try {
    const res = await fetch("/apps/warranty/my-products");
    const data = await res.json();
    const products = Array.isArray(data.products) ? data.products : [];

    hideProductsLoader();

    if (!products.length) {
      sliderWrapper?.classList.add("hidden");
      return;
    }

    console.log("from my product api", data);

    sliderWrapper.classList.remove("hidden");

    track.innerHTML = products
      .map(
        (p) => `
    <div class="swiper-slide">
    <div class="mp-card"  data-registration-id="${p.register_id || ""}"
             data-product-id="${p.product_id}"
             data-line-item-id="${p.line_item_id}"
             data-order-id="${p.order_id || ""}"
             data-source="${p.source || "shopify"}">
      
      <div class="product-wrapper">
        <div class="mp-card-img">
          ${
            p.image
              ? `<img src="${p.image}" alt="${p.title}">`
              : `<div class="no-image"></div>`
          }
        </div>
        <h3>${p.title}</h3>
        ${
          p.is_registered  
            ? ""
            : `<h2 class="gray-text">Purchased on: ${formatDate(p.purchase_date)}</h2>`
        }
      </div>

      <div class="mp-card-body">
        ${
          p.is_registered
            ? `
              <div class="expiry">
                <span class="gray-text">Serial No.: ${
                  p.serial_number || "-"
                }</span>

                ${(() => {
                  const status = getWarrantyStatus(p.warranty_end);
                  if (!status) return "";

                  return `
      <div class="mp-warranty-badge mp-${status.type}">
        <img
      class="mp-warranty-icon"
      src="${status.icon}"
      alt="${status.label}"
    />
        ${status.label}
      </div>
    `;
                })()}

                <span class=gray-text>Warranty Expiry: ${formatDate(
                  p.warranty_end,
                )}</span>
                ${
                  p.extended_warranty?.displayStatus &&
                  p.extended_warranty.displayStatus !== "Not Purchased"
                    ? `<span class="gray-text">Extended: ${p.extended_warranty.displayStatus}${
                        p.extended_warranty.extendedWarrantyEndDate
                          ? ` · until ${formatDate(p.extended_warranty.extendedWarrantyEndDate)}`
                          : p.extended_warranty.endDate
                            ? ` · until ${formatDate(p.extended_warranty.endDate)}`
                            : ""
                      }</span>`
                    : ""
                }
              </div>

                ${(() => {
                  if (isPendingExtendedWarranty(p)) {
                    return `<button type="button" class="btn mp-complete-ew-btn" data-register-id="${p.register_id}" data-source="${p.source || "shopify"}">Complete extended warranty payment</button>
                       <button class="btn bordered-btn" data-product-id="${p.product_id}">View Details</button>`;
                  }
                  if (canShowExtendWarrantyButton(p)) {
                    return `<button type="button" class="btn mp-extend-warranty-btn" data-register-id="${p.register_id}" data-source="${p.source || "shopify"}">Extend Warranty</button>`;
                  }
                  return `<button class="btn bordered-btn" data-product-id="${p.product_id}">View Details</button>`;
                })()}
            `
            : `
            <div
                id="mp-web-register-btn"
                class="btn"
                data-product-id="${p.product_id}"
                data-order-id="${p.order_id}"
                data-source="shopify">
                ${web_register_label}
              </div>
            `
        }
      </div>
    </div>
    </div>
  `,
      )
      .join("");
  } catch (err) {
    hideProductsLoader();
    console.error("Warranty error:", err);
  }

  /* ===============================
     REGISTER CLICK (UNCHANGED)
  =============================== */

  document.addEventListener("click", (e) => {
    const btn = e.target.closest(
      "#mp-external-register-btn , #mp-web-register-btn, #mp-detail-web-register-btn"
    );
    if (!btn) return;

    e.preventDefault();

    const source = btn.dataset.source;
    let sessionPayload = {};

    if (source === "shopify") {

      console.log("source : ", source);
      const orderId = btn.dataset.orderId;
      const productId = btn.dataset.productId;

      if (!orderId || !productId) {
        console.error("Missing order_id or product_id for Shopify flow");
        return;
      }

      sessionPayload = {
        flow: "shopify",
        order_id: orderId,
        product_id: productId,
      };


      
    sessionStorage.setItem(
      "warranty_registration_context",
      JSON.stringify(sessionPayload)
    );

      console.log("External Link : ", externalBTN, external_register_link);


    window.location.href = web_register_link;

    } else if (source === "external") {
            console.log("source : ", source);
      sessionPayload = { flow: "external" };


      
    sessionStorage.setItem(
      "warranty_registration_context",
      JSON.stringify(sessionPayload)
    );

      console.log("External Link : ", externalBTN, external_register_link);


    window.location.href = external_register_link;

    } else {
      console.error("Unknown registration source");
      return;
    }

    // sessionStorage.setItem(
    //   "warranty_registration_context",
    //   JSON.stringify(sessionPayload)
    // );

    //   console.log("External Link : ", externalBTN, external_register_link);


    // window.location.href = web_register_link;
  });

  /* ===============================
     UPDATED PRODUCT DETAIL VIEW
     (Now uses POST API)
  =============================== */
    document.addEventListener("click", async (e) => {
    const card = e.target.closest(".mp-card");
    if (!card) return;

    /* ===== UPDATED: Prevent register click from opening detail ===== */
    if (e.target.closest(".mp-register-btn")) return;
    if (e.target.closest(".mp-complete-ew-btn, .mp-extend-warranty-btn")) return;

    const registrationId = card.dataset.registrationId || null;
    const lineItemId = card.dataset.lineItemId ;
    const productId = card.dataset.productId;
    const orderId = card.dataset.orderId || null;
    const flow = card.dataset.source || "shopify";

    try {
      /* ===== UPDATED: NEW API CALL ===== */
      const response = await fetch("/apps/warranty/product-detail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registration_id: registrationId,
          product_id: productId,
          line_item_id: lineItemId,
          order_id: orderId,
          flow,
        }),
      });

      const data = await response.json();

      console.log("product detail json: ", data.success, data.product);

      if (!data.success) {
              console.log("product detail json 222: ", data.success);

        console.error("Product detail error:", data.error);
        return;
      }
      
      console.log("product detail json 333: ", data.success);

      renderProductDetail(data);

    } catch (error) {
      console.error("Product detail fetch failed:", error);
    }
  });


  document.addEventListener("click", e => {
    const completeBtn = e.target.closest(".mp-complete-ew-btn");
    if (completeBtn) {
      resumeExtendedWarrantyPayment(
        completeBtn.dataset.registerId,
        completeBtn.dataset.source
      );
      return;
    }

    const extendBtn = e.target.closest(".mp-extend-warranty-btn");
    if (extendBtn) {
      resumeExtendedWarrantyPayment(
        extendBtn.dataset.registerId,
        extendBtn.dataset.source
      );
      return;
    }

    const backBtn = e.target.closest("#mp-detail-back-btn");
    if (!backBtn) return;
    showMyProductsView();
  });

  function renderProductDetail(data) {
    if (!data?.product) return;

    const product = data.product;

    console.log(product);
    productsSection.classList.add("hidden");
    detailSection.classList.remove("hidden");

    document.getElementById("mp-detail-image").src =
      product.image || "";

    const registeredEl =
      document.getElementById("mp-detail-registered");
    const unregisteredEl =
      document.getElementById("mp-detail-unregistered");

    registeredEl.classList.add("hidden");
    unregisteredEl.classList.add("hidden");

    if (product.is_registered) {
      registeredEl.classList.remove("hidden");

      document.getElementById("mp-detail-title").innerText =
        product.title;

      document.getElementById("mp-detail-date").innerText =
        `Purchase date: ${formatDate(product.purchase_date)}`;

      document.getElementById("mp-detail-serial").innerText =
        `Serial No: ${product.serial_number || "-"}`;

      document.getElementById("mp-detail-warranty").innerText =
        product.warranty_end
          ? formatDate(product.warranty_end)
          : "Not registered";

      const ewSection = document.getElementById("mp-detail-extended-warranty");
      const ew = product.extended_warranty;
      const completeBtn = document.getElementById("mp-detail-complete-ew-btn");
      const extendBtn = document.getElementById("mp-detail-extend-warranty-btn");

      if (ewSection && ew && ew.displayStatus && ew.displayStatus !== "Not Purchased") {
        ewSection.classList.remove("hidden");
        document.getElementById("mp-detail-extended-status").innerText =
          `Status: ${ew.displayStatus}`;
        document.getElementById("mp-detail-extended-plan").innerText =
          ew.planName ? `Plan: ${ew.planName}` : "";
        document.getElementById("mp-detail-extended-dates").innerText = [
          ew.extendedWarrantyStartDate || ew.startDate
            ? `Coverage start: ${formatDate(ew.extendedWarrantyStartDate || ew.startDate)}`
            : "",
          ew.extendedWarrantyEndDate || ew.endDate
            ? `Coverage end: ${formatDate(ew.extendedWarrantyEndDate || ew.endDate)}`
            : "",
        ]
          .filter(Boolean)
          .join(" · ");
      } else if (ewSection) {
        ewSection.classList.add("hidden");
      }

      if (completeBtn) {
        if (isPendingExtendedWarranty(product)) {
          completeBtn.classList.remove("hidden");
          completeBtn.onclick = () =>
            resumeExtendedWarrantyPayment(
              product.register_id,
              product.source || "shopify"
            );
        } else {
          completeBtn.classList.add("hidden");
          completeBtn.onclick = null;
        }
      }

      if (extendBtn) {
        if (canShowExtendWarrantyButton(product)) {
          extendBtn.classList.remove("hidden");
          extendBtn.onclick = () =>
            resumeExtendedWarrantyPayment(
              product.register_id,
              product.source || "shopify"
            );
        } else {
          extendBtn.classList.add("hidden");
          extendBtn.onclick = null;
        }
      }

      const statusEl =
        document.getElementById("mp-detail-status");
      const status = getWarrantyStatus(product.warranty_end);

      if (status) {
        statusEl.className =
          `mp-warranty-badge mp-${status.type}`;
        statusEl.innerHTML = `
          <img class="mp-warranty-icon"
               src="${status.icon}"
               alt="${status.label}" />
          ${status.label}
        `;
        statusEl.classList.remove("hidden");
      } else {
        statusEl.classList.add("hidden");
      }
    } else {
      unregisteredEl.classList.remove("hidden");

      document.getElementById(
        "mp-detail-title-unregistered"
      ).innerText = product.title;

      document.getElementById(
        "mp-detail-date-unregistered"
      ).innerText =
        `Purchase date: ${formatDate(product.purchase_date)}`;

      const registerBtn =
        document.getElementById("mp-detail-web-register-btn");

      registerBtn.dataset.productId = product.product_id;
      registerBtn.dataset.orderId = product.order_id || "";
      registerBtn.dataset.source = product.source || "shopify";
    }

    document.getElementById("breadcrumb-my-products")?.addEventListener(
      "click",
      (e) => {
        e.preventDefault();
        showMyProductsView();
      }
    );
  }

  function showMyProductsView() {
    productsSection.classList.remove("hidden");
    detailSection.classList.add("hidden");
    document
      .getElementById("breadcrumb-container")
      ?.classList.add("hidden");
    rootWarpper.classList.remove("breadcrumb-mobile");
  }

  var swiper = new Swiper(".mp-slider", {
    slidesPerView: 1,
    spaceBetween: 12,
    breakpoints: {
      576: { slidesPerView: 2, spaceBetween: 12 },
      768: { slidesPerView: 2.5, spaceBetween: 15 },
      991: { slidesPerView: 3, spaceBetween: 15 },
    },
    navigation: {
      nextEl: ".mp-nav.swiper-button-next",
      prevEl: ".mp-nav.swiper-button-prev",
    },
  });
})();
