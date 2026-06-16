(() => {
  const POST_REG_KEY = "warranty_post_registration_state";
  const REG_CONTEXT_KEY = "warranty_registration_context";
  const MAX_AGE_MS = 2 * 60 * 60 * 1000;

  function readJson(key) {
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function writeJson(key, value) {
    sessionStorage.setItem(key, JSON.stringify(value));
  }

  window.WarrantyFlowState = {
    savePostRegistration(state) {
      writeJson(POST_REG_KEY, { ...state, savedAt: Date.now() });
    },

    getPostRegistration() {
      const state = readJson(POST_REG_KEY);
      if (!state?.savedAt) return null;
      if (Date.now() - state.savedAt > MAX_AGE_MS) {
        sessionStorage.removeItem(POST_REG_KEY);
        return null;
      }
      return state;
    },

    clearPostRegistration() {
      sessionStorage.removeItem(POST_REG_KEY);
    },

    getRegistrationContext() {
      return readJson(REG_CONTEXT_KEY);
    },

    clearRegistrationContext() {
      sessionStorage.removeItem(REG_CONTEXT_KEY);
    },

    async restoreExtendedWarrantyOffer(options = {}) {
      const state = this.getPostRegistration();
      if (!state?.registerId || !window.ExtendedWarrantyOffer) {
        return false;
      }

      try {
        const res = await fetch(
          `/apps/warranty/extended-warranty/offer?register_id=${encodeURIComponent(state.registerId)}`
        );
        const data = await res.json();

        if (!res.ok || !data.eligible) {
          if (data.reason === "already_purchased") {
            this.clearPostRegistration();
            window.WarrantyToast?.showSuccess(
              "Extended warranty is already active for this product."
            );
          }
          return false;
        }

        const rendered = window.ExtendedWarrantyOffer.renderOffer(data, {
          myProductsLink: options.myProductsLink || state.myProductsLink || "/pages/my-products",
          customerEmail: state.customerEmail || "",
          customerName: state.customerName || "",
          onSkip: () => {
            this.clearPostRegistration();
            window.location.href =
              options.myProductsLink || state.myProductsLink || "/pages/my-products";
          },
        });

        return rendered;
      } catch (err) {
        console.error("Failed to restore extended warranty offer:", err);
        return false;
      }
    },
  };
})();
