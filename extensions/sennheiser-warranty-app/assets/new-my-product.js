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

function hasExtendedWarranty(product) {
  const status = product?.extended_warranty?.status;
  return status === "active" || status === "expired" || status === "refunded";
}

function getExtendedWarrantyCardBadge(product) {
  const ew = product?.extended_warranty;
  if (!ew?.displayStatus || ew.displayStatus === "Not Purchased") return null;

  const label = ew.displayStatus;
  const normalized = label.toLowerCase();

  if (normalized.includes("refund")) {
    return { type: "ew-refunded", label };
  }
  if (normalized.includes("cancel")) {
    return { type: "ew-cancelled", label };
  }
  if (ew.status === "active" || label === "Active") {
    return { type: "ew-active", label: "Active Warranty" };
  }
  if (ew.status === "expired" || label === "Expired") {
    return { type: "ew-expired", label: "Warranty Expired" };
  }

  return { type: "ew-status", label };
}

function isPurchaseWindowExpired(product) {
  const eligibility = product?.extended_warranty_eligibility;
  if (eligibility?.reason === "purchase_window_expired") return true;

  const pw = eligibility?.purchaseWindow;
  return Boolean(pw?.configured && pw.allowed === false);
}

function canShowExtendWarrantyButton(product) {
  if (isPurchaseWindowExpired(product)) return false;

  return (
    product?.is_registered &&
    !hasExtendedWarranty(product) &&
    Boolean(product?.can_extend_warranty)
  );
}

function getProductCardAction(product) {
  if (!product.is_registered) return "register";
  if (hasExtendedWarranty(product)) return "view_details";
  if (canShowExtendWarrantyButton(product)) return "extend_warranty";
  return "view_details";
}

function savePostRegistrationForExtendWarranty(registerId, myProductsLink) {
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
  if (!rootWarpper) return;

  await window.WarrantyFlowState?.checkMyProductsToasts?.();

  const registerLink = rootWarpper.dataset.registerLink;
  const web_register_label =
    rootWarpper.dataset.webRegisterLabel || "+ Register product";

  const web_register_link = rootWarpper.dataset.webRegisterLink || registerLink;
  const externalBTN = document.getElementById("mp-external-register-btn");
  const external_register_link = externalBTN?.dataset.externalRegisterLink || web_register_link;

  function startExtendWarrantyFlow(registerId, source) {
    if (!registerId) return;
    savePostRegistrationForExtendWarranty(registerId, window.location.pathname);
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

  let detailHistoryActive = false;

  function activateDetailHistory() {
    if (detailHistoryActive) return;
    history.pushState({ mpProductDetail: true }, "", window.location.href);
    detailHistoryActive = true;
  }

  function requestCloseProductDetail() {
    if (detailHistoryActive) {
      history.back();
      return;
    }
    showMyProductsView();
  }

  window.addEventListener("popstate", () => {
    if (!detailHistoryActive) return;
    detailHistoryActive = false;
    showMyProductsView({ fromPopstate: true });
  });

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

  function initMpSlider() {
    if (window.mpProductsSwiper) {
      window.mpProductsSwiper.destroy(true, true);
    }

    window.mpProductsSwiper = new Swiper(".mp-slider", {
      slidesPerView: 1,
      spaceBetween: 16,
      watchOverflow: true,
      breakpoints: {
        576: { slidesPerView: 2, spaceBetween: 16 },
        768: { slidesPerView: 2, spaceBetween: 20 },
        991: { slidesPerView: 3, spaceBetween: 20 },
      },
      navigation: {
        nextEl: ".mp-nav.swiper-button-next",
        prevEl: ".mp-nav.swiper-button-prev",
      },
    });
  }

  let pendingRegistrationId = null;
  try {
    const params = new URLSearchParams(window.location.search);
    const rawId = params.get("registration_id");
    if (rawId) {
      const parsed = Number(rawId);
      if (Number.isFinite(parsed) && parsed > 0) {
        pendingRegistrationId = parsed;
      }
    }
  } catch {
    pendingRegistrationId = null;
  }

  function clearRegistrationIdFromUrl() {
    try {
      const url = new URL(window.location.href);
      if (!url.searchParams.has("registration_id")) return;
      url.searchParams.delete("registration_id");
      const query = url.searchParams.toString();
      const next = url.pathname + (query ? `?${query}` : "");
      history.replaceState(history.state, "", next);
    } catch {
      // ignore URL cleanup errors
    }
  }

  async function openProductDetailFromDeepLink(registrationId) {
    if (!registrationId) return;

    clearRegistrationIdFromUrl();

    const card = document.querySelector(
      `.mp-card[data-registration-id="${registrationId}"]`
    );

    if (card) {
      await fetchAndShowProductDetail({
        registrationId: card.dataset.registrationId,
        lineItemId: card.dataset.lineItemId,
        productId: card.dataset.productId,
        orderId: card.dataset.orderId || null,
        flow: card.dataset.source || "shopify",
      });
      return;
    }

    await fetchAndShowProductDetail({ registrationId });
  }

  showProductsLoader();

  try {
    const res = await fetch("/apps/warranty/my-products");
    const data = await res.json();
    const products = Array.isArray(data.products) ? data.products : [];

    hideProductsLoader();

    if (!products.length) {
      sliderWrapper?.classList.add("hidden");
    } else {
      console.log("from my product api", data);

      sliderWrapper.classList.remove("hidden");

      track.innerHTML = products
      .map((p) => {
        const action = getProductCardAction(p);
        const warrantyStatus = p.is_registered
          ? getWarrantyStatus(p.warranty_end)
          : null;
        const ewBadge = getExtendedWarrantyCardBadge(p);
        const finalWarrantyExpiry = hasExtendedWarranty(p)
          ? p.extended_warranty?.extendedWarrantyEndDate ||
            p.extended_warranty?.endDate ||
            p.warranty_end
          : p.warranty_end;

        const actionButton =
          action === "extend_warranty"
            ? `<button type="button" class="btn mp-extend-warranty-btn" data-register-id="${p.register_id}" data-source="${p.source || "shopify"}">Extend Warranty</button>`
            : action === "view_details"
              ? `<button type="button" class="btn bordered-btn mp-view-details-btn" data-product-id="${p.product_id}">View Details</button>`
              : `<div class="btn mp-web-register-btn" data-product-id="${p.product_id}" data-order-id="${p.order_id || ""}" data-source="${p.source || "shopify"}">${web_register_label}</div>`;

        const registeredInfo = p.is_registered
          ? `
              <div class="expiry">
                <span class="gray-text">Serial No.: ${p.serial_number || "-"}</span>
                ${
                  ewBadge
                    ? `<div class="mp-warranty-badge mp-${ewBadge.type}">
                        ${ewBadge.label}
                      </div>`
                    : warrantyStatus
                    ? `<div class="mp-warranty-badge mp-${warrantyStatus.type}">
                        <img class="mp-warranty-icon" src="${warrantyStatus.icon}" alt="${warrantyStatus.label}" />
                        ${warrantyStatus.label}
                      </div>`
                    : ""
                }
                <span class="gray-text">Warranty Expiry: ${formatDate(finalWarrantyExpiry)}</span>
              </div>`
          : `<div class="expiry expiry--placeholder" aria-hidden="true"></div>`;

        return `
    <div class="swiper-slide">
      <div class="mp-card"
           data-registration-id="${p.register_id || ""}"
           data-product-id="${p.product_id}"
           data-line-item-id="${p.line_item_id || ""}"
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
              : `<p class="gray-text">Purchased on: ${formatDate(p.purchase_date)}</p>`
          }
        </div>
        <div class="mp-card-body">
          ${registeredInfo}
          <div class="mp-card-actions">
            ${actionButton}
          </div>
        </div>
      </div>
    </div>`;
      })
      .join("");

      initMpSlider();
    }
  } catch (err) {
    hideProductsLoader();
    console.error("Warranty error:", err);
  }

  /* ===============================
     REGISTER CLICK (UNCHANGED)
  =============================== */

  document.addEventListener("click", (e) => {
    const btn = e.target.closest(
      "#mp-external-register-btn, .mp-web-register-btn, #mp-detail-web-register-btn"
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
  async function fetchAndShowProductDetail({
    registrationId,
    lineItemId,
    productId,
    orderId,
    flow,
  }) {
    const response = await fetch("/apps/warranty/product-detail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        registration_id: registrationId ? Number(registrationId) : null,
        product_id: productId,
        line_item_id: lineItemId,
        order_id: orderId,
        flow,
      }),
    });

    const data = await response.json();

    if (!data.success) {
      console.error("Product detail error:", data.error);
      return;
    }

    renderProductDetail(data);
  }

  document.addEventListener("click", async (e) => {
    const viewDetailsBtn = e.target.closest(".mp-view-details-btn");
    if (viewDetailsBtn) {
      e.preventDefault();
      e.stopPropagation();
      const card = viewDetailsBtn.closest(".mp-card");
      if (!card) return;

      try {
        await fetchAndShowProductDetail({
          registrationId: card.dataset.registrationId,
          lineItemId: card.dataset.lineItemId,
          productId: card.dataset.productId,
          orderId: card.dataset.orderId || null,
          flow: card.dataset.source || "shopify",
        });
      } catch (error) {
        console.error("Product detail fetch failed:", error);
      }
      return;
    }

    const card = e.target.closest(".mp-card");
    if (!card) return;

    /* ===== UPDATED: Prevent register click from opening detail ===== */
    if (e.target.closest(".mp-register-btn")) return;
    if (e.target.closest(".mp-extend-warranty-btn, .mp-web-register-btn")) return;

    const registrationId = card.dataset.registrationId || null;
    const lineItemId = card.dataset.lineItemId;
    const productId = card.dataset.productId;
    const orderId = card.dataset.orderId || null;
    const flow = card.dataset.source || "shopify";

    try {
      await fetchAndShowProductDetail({
        registrationId,
        lineItemId,
        productId,
        orderId,
        flow,
      });
    } catch (error) {
      console.error("Product detail fetch failed:", error);
    }
  });


  document.addEventListener("click", e => {
    const extendBtn = e.target.closest(".mp-extend-warranty-btn");
    if (extendBtn) {
      startExtendWarrantyFlow(
        extendBtn.dataset.registerId,
        extendBtn.dataset.source
      );
      return;
    }

    const backBtn = e.target.closest("#mp-detail-back-btn");
    if (backBtn) {
      requestCloseProductDetail();
      return;
    }
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
      const extendBtn = document.getElementById("mp-detail-extend-warranty-btn");

      if (ewSection && ew && hasExtendedWarranty(product)) {
        ewSection.classList.remove("hidden");
        document.getElementById("mp-detail-extended-status").innerText =
          `Status: ${ew.displayStatus || ew.status || "Unknown"}`;
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

        const refundEl = document.getElementById("mp-detail-extended-refund");
        if (refundEl) {
          if (ew.refundDate) {
            refundEl.classList.remove("hidden");
            refundEl.innerText = `Refund date: ${formatDate(ew.refundDate)}${
              ew.refundAmount != null
                ? ` · Amount: ${Number(ew.refundAmount).toFixed(2)} ${ew.currency || ""}`.trim()
                : ""
            }`;
          } else {
            refundEl.classList.add("hidden");
            refundEl.innerText = "";
          }
        }
      } else if (ewSection) {
        ewSection.classList.add("hidden");
      }

      if (extendBtn) {
        if (canShowExtendWarrantyButton(product)) {
          extendBtn.classList.remove("hidden");
          extendBtn.innerText = "Extend Warranty";
          extendBtn.onclick = () =>
            startExtendWarrantyFlow(
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
        requestCloseProductDetail();
      }
    );

    activateDetailHistory();
  }

  function showMyProductsView(options = {}) {
    if (!options.fromPopstate && detailHistoryActive) {
      detailHistoryActive = false;
      const nextState = { ...(history.state || {}) };
      delete nextState.mpProductDetail;
      history.replaceState(nextState, "", window.location.href);
    }
    productsSection.classList.remove("hidden");
    detailSection.classList.add("hidden");
    document
      .getElementById("breadcrumb-container")
      ?.classList.add("hidden");
    rootWarpper.classList.remove("breadcrumb-mobile");
  }

  if (pendingRegistrationId) {
    try {
      await openProductDetailFromDeepLink(pendingRegistrationId);
    } catch (deepLinkErr) {
      console.error("Registration deep-link failed:", deepLinkErr);
    }
  }
})();
