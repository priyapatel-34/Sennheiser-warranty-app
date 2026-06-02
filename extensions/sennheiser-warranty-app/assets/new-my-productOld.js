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

  // ❌ expired
  if (endDate < today) {
    return {
      type: "expired",
      label: "Expired",
      icon: icons.expired,
    };
  }

  // ⚠ expiring soon (≤ 2 months)
  const twoMonthsFromNow = new Date(today);
  twoMonthsFromNow.setMonth(twoMonthsFromNow.getMonth() + 2);

  if (endDate <= twoMonthsFromNow) {
    return {
      type: "expiring",
      label: "Expiring Soon",
      icon: icons.expiring,
    };
  }

  // ✅ active
  return {
    type: "active",
    label: "Active Warranty",
    icon: icons.active,
  };
}

(async () => {
  const rootWarpper = document.getElementById("mp-app-root");
  const registerLink = rootWarpper.dataset.registerLink;
  const web_register_label =
    rootWarpper.dataset.webRegisterLabel || "+ Register product";

  const web_register_link = rootWarpper.dataset.webRegisterLink || registerLink;

  rootWarpper.classList.remove("breadcrumb-mobile");

  const track = document.getElementById("mp-track");
  const sliderWrapper = document.querySelector(".slider-wrapper");
  const productsSection = document.querySelector(".product-outer-wrapper");
  const detailSection = document.getElementById("mp-product-detail");

  if (!track) return;

  try {
    const res = await fetch("/apps/warranty/my-products");
    const data = await res.json();

    const products = Array.isArray(data.products) ? data.products : [];

    if (!products.length) {
      sliderWrapper?.classList.add("hidden");
      return;
    }

    sliderWrapper.classList.remove("hidden");

    track.innerHTML = "";

    track.innerHTML = products
      .map(
        (p) => `
    <div class="swiper-slide">
    <div class="mp-card" data-id="${p.product_id}">
      
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
              </div>

              <button
                class="btn bordered-btn"
                data-product-id="${p.product_id}">
                View Details
              </button>
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
    console.error("Warranty error:", err);
  }

  /* ===============================
     REGISTER CLICK
  =============================== */
  // document.addEventListener("click", (e) => {
  //   const btn = e.target.closest(".mp-register-btn");
  //   if (!btn) return;

  //   e.preventDefault();

  //   const orderId = btn.dataset.orderId;
  //   const productId = btn.dataset.productId;

  //   if (!orderId || !productId) {
  //     console.error("Missing order_id or product_id");
  //     return;
  //   }

  //   const url = new URL(registerLink, window.location.origin);

  //   // url.searchParams.set("order_id", orderId);
  //   // url.searchParams.set("product_id", productId);

  //   sessionStorage.setItem(
  //     "warranty_registration_context",
  //     JSON.stringify({
  //       order_id: orderId,
  //       product_id: productId,
  //     }),
  //   );

  //   window.location.href = web_register_link;
  // });

  document.addEventListener("click", (e) => {
    const btn = e.target.closest(
      "#mp-external-register-btn , #mp-web-register-btn, #mp-detail-web-register-btn"
    );
    if (!btn) return;

    e.preventDefault();

    const source = btn.dataset.source;

    let sessionPayload = {};

    if (source === "shopify") {
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
    } else if (source === "external") {
      sessionPayload = {
        flow: "external",
      };
    } else {
      console.error("Unknown registration source");
      return;
    }

    // ✅ Store in session
    sessionStorage.setItem(
      "warranty_registration_context",
      JSON.stringify(sessionPayload),
    );

    // ✅ Redirect
    window.location.href = web_register_link;
  });

  /* ===============================
     PRODUCT DETAIL VIEW
  =============================== */
  // document.addEventListener("click", (e) => {
  //   const card = e.target.closest(".mp-card");
  //   if (!card || e.target.closest(".mp-register-btn")) return;

  //   const productId = card.dataset.id;
  //   if (!productId) return;

  //   showProductDetail(productId);
  // });

  document.addEventListener("click", (e) => {
    const viewBtn = e.target.closest(".mp-view-btn");
    const card = e.target.closest(".mp-card");

    if (e.target.closest(".mp-register-btn")) return;

    if (viewBtn) {
      const productId = viewBtn.dataset.productId;
      if (!productId) return;
      showProductDetail(productId);
      return;
    }

    if (card) {
      const productId = card.dataset.id;
      if (!productId) return;
      showProductDetail(productId);
    }
  });

  function showProductDetail(productId) {
    fetch("/apps/warranty/my-products")
      .then((r) => r.json())
      .then(({ products }) => {
        const product = products.find(
          (p) => String(p.product_id) === String(productId),
        );

        if (!product) return;

        renderProductDetail({ product });
      });
  }

  document.addEventListener("click", (e) => {
    const backBtn = e.target.closest("#mp-detail-back-btn");
    if (!backBtn) return;
  
    showMyProductsView();
  });

  function renderProductDetail(data) {
    if (!data?.product) return;

    const product = data.product;

    // Layout switch
    // rootWarpper.classList.add("breadcrumb-mobile");
    // productsSection.classList.add("hidden");
    // detailSection.classList.remove("hidden");

    // document.getElementById("breadcrumb-container").classList.remove("hidden");
    // document.getElementById("breadcrumb-current").innerText = product.title;

    // Image
    document.getElementById("mp-detail-image").src = product.image || "";

    // Containers
    const registeredEl = document.getElementById("mp-detail-registered");
    const unregisteredEl = document.getElementById("mp-detail-unregistered");

    // Reset visibility
    registeredEl.classList.add("hidden");
    unregisteredEl.classList.add("hidden");

    /* ==================================
     REGISTERED PRODUCT
  ================================== */
    if (product.is_registered) {
      registeredEl.classList.remove("hidden");

      // Title
      document.getElementById("mp-detail-title").innerText = product.title;

      // Purchase Date
      document.getElementById(
        "mp-detail-date",
      ).innerText = `Purchase date: ${formatDate(product.purchase_date)}`;

      // Serial Number
      document.getElementById("mp-detail-serial").innerText = `Serial No: ${
        product.serial_number || "-"
      }`;

      // Warranty Expiry
      document.getElementById("mp-detail-warranty").innerText =
        product.warranty_end
          ? formatDate(product.warranty_end)
          : "Not registered";

      // Warranty Status Badge
      const statusEl = document.getElementById("mp-detail-status");
      const status = getWarrantyStatus(product.warranty_end);

      if (status) {
        statusEl.className = `mp-warranty-badge mp-${status.type}`;
        statusEl.innerHTML = `
  <img
    class="mp-warranty-icon"
    src="${status.icon}"
    alt="${status.label}"
  />
  ${status.label}
`;
        statusEl.classList.remove("hidden");
      } else {
        statusEl.classList.add("hidden");
      }
    } else {
      /* ==================================
     UNREGISTERED PRODUCT
  ================================== */
      unregisteredEl.classList.remove("hidden");

      document.getElementById("mp-detail-title-unregistered").innerText =
        product.title;

      document.getElementById(
        "mp-detail-date-unregistered",
      ).innerText = `Purchase date: ${formatDate(product.purchase_date)}`;

      const registerBtn = document.getElementById("mp-detail-web-register-btn");

      registerBtn.dataset.productId = product.product_id;
      registerBtn.dataset.orderId = product.order_id || "";
      registerBtn.dataset.source = product.source || "shopify";
    }

    // Breadcrumb back
    document.getElementById("breadcrumb-my-products").onclick = (e) => {
      e.preventDefault();
      showMyProductsView();
    };

    // detailSection.scrollIntoView({ behavior: "smooth" });
  }

  // function renderProductDetail(data) {
  //   if (!data?.product) return;

  //   const product = data.product;

  //   rootWarpper.classList.add("breadcrumb-mobile");
  //   productsSection.classList.add("hidden");
  //   detailSection.classList.remove("hidden");

  //   document.getElementById("breadcrumb-container").classList.remove("hidden");
  //   document.getElementById("breadcrumb-current").innerText = product.title;

  //   // Image
  //   document.getElementById("mp-detail-image").src = product.image || "";

  //   // Title
  //   document.getElementById("mp-detail-title").innerText = product.title;

  //   // Purchase Date
  //   document.getElementById(
  //     "mp-detail-date",
  //   ).innerText = `Purchase date: ${formatDate(product.purchase_date)}`;

  //   // Serial Number
  //   document.getElementById("mp-detail-serial").innerText = `Serial No: ${
  //     product.serial_number || "-"
  //   }`;

  //   // Warranty
  //   const warrantyEl = document.getElementById("mp-detail-warranty");
  //   warrantyEl.innerText = product.warranty_end
  //     ? formatDate(product.warranty_end)
  //     : "Not registered";

  //   // Active Warranty Badge
  //   const statusEl = document.getElementById("mp-detail-status");

  //   const status = getWarrantyStatus(product.warranty_end);

  //   if (!status) {
  //     statusEl.classList.add("hidden");
  //   } else {
  //     statusEl.classList.remove("hidden");
  //     statusEl.innerHTML = `
  //   <span class="mp-warranty-icon">${status.icon}</span>
  //   ${status.label}
  // `;
  //     statusEl.className = `mp-detail-status mp-${status.type}`;
  //   }

  //   document.getElementById("breadcrumb-my-products").onclick = (e) => {
  //     e.preventDefault();
  //     showMyProductsView();
  //   };

  //   detailSection.scrollIntoView({ behavior: "smooth" });
  // }

  // function renderProductDetail(data) {
  //   if (!data?.product) return;

  //   activeProductForRegistration = data.product;

  //   const registerBtn = document.getElementById("mp-register-btn");

  //   if (registerBtn) {
  //     registerBtn.dataset.productId = data.product.product_id;
  //     registerBtn.dataset.orderId = data.product.order_id || "";
  //   }

  //   const breadcrumbContainer = document.getElementById("breadcrumb-container");
  //   const breadcrumbCurrent = document.getElementById("breadcrumb-current");
  //   const breadcrumbMyProductsLink = document.getElementById("breadcrumb-my-products");

  //   rootWarpper.classList.add("breadcrumb-mobile");

  //   productsSection.classList.add("hidden");
  //   detailSection.classList.remove("hidden");
  //   breadcrumbContainer.classList.remove("hidden");

  //   breadcrumbCurrent.innerText = data.product.title;

  //   document.getElementById("mp-detail-image").src =
  //     data.product.image || "";

  //   document.getElementById("mp-detail-title").innerText =
  //     data.product.title;

  //     console.log("data.product.purchase_date ::", data.product);

  //   document.getElementById("mp-detail-date").innerText =
  //     `Purchase date: ${formatDate(data.product.purchase_date)}`;
  //   `Serial Number: ${data.product.serial_number || "-"}`;

  //   document.getElementById("mp-detail-title").innerText =
  //     `Vendor warranty on:`;

  //   document.getElementById("mp-detail-warranty").innerText =
  //     data.product.warranty_end
  //       ? `Warranty expiry: ${formatDate(data.product.warranty_end)}`
  //       : "Warranty not registered";

  //   breadcrumbMyProductsLink.onclick = e => {
  //     e.preventDefault();
  //     showMyProductsView();
  //   };

  //   detailSection.scrollIntoView({ behavior: "smooth" });
  // }

  function showMyProductsView() {
    productsSection.classList.remove("hidden");
    detailSection.classList.add("hidden");
    document.getElementById("breadcrumb-container").classList.add("hidden");
    rootWarpper.classList.remove("breadcrumb-mobile");
  }

  function initSlider() {
    if (!window.Swiper) return;

    if (window.myProductsSwiper) {
      window.myProductsSwiper.destroy(true, true);
    }

    window.myProductsSwiper = new Swiper(".slider-wrapper", {
      slidesPerView: 1.2,
      spaceBetween: 12,
      loop: false,

      breakpoints: {
        640: { slidesPerView: 2.2 },
        1024: { slidesPerView: 4 },
      },

      navigation: {
        nextEl: ".slider-next",
        prevEl: ".slider-prev",
      },
    });
  }

  // requestAnimationFrame(initSlider);

  // const swiper = new Swiper('.swiper', {
  //   // Optional parameters
  //   // direction: 'vertical',
  //   loop: true,

  //   // If we need pagination
  //   pagination: {
  //     el: '.swiper-pagination',
  //   },

  //   // Navigation arrows
  //   navigation: {
  //     nextEl: '.swiper-button-next',
  //     prevEl: '.swiper-button-prev',
  //   },

  //   // And if we need scrollbar
  //   scrollbar: {
  //     el: '.swiper-scrollbar',
  //   },
  // });

  var swiper = new Swiper(".mp-slider", {
    slidesPerView: 1,
    spaceBetween: 12,
    breakpoints: {
      576: {
        slidesPerView: 2,
        spaceBetween: 12,
      },
      768: {
        slidesPerView: 2.5,
        spaceBetween: 15,
      },
      991: {
        slidesPerView: 3,
        spaceBetween: 15,
      },
    },

    navigation: {
      nextEl: ".mp-nav.swiper-button-next",
      prevEl: ".mp-nav.swiper-button-prev",
    },
  });
})();
