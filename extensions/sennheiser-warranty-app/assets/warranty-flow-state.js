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

  async function fetchExtendedWarrantyOffer(registerId) {
    const res = await fetch(
      `/apps/warranty/extended-warranty/offer?register_id=${encodeURIComponent(registerId)}`
    );
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to load extended warranty offer");
    }
    return data;
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

    async resolveExtendedWarrantyOffer(data) {
      if (data?.extendedWarrantyOffer?.eligible) {
        return data.extendedWarrantyOffer;
      }

      const registerId = data?.registrations?.[0]?.registerId;
      if (!registerId) return data?.extendedWarrantyOffer || null;

      try {
        return await fetchExtendedWarrantyOffer(registerId);
      } catch (err) {
        console.warn("Extended warranty offer fetch failed:", err.message);
        return data?.extendedWarrantyOffer || null;
      }
    },

    /**
     * After standard registration:
     * - eligible EW within purchase window → show offer page
     * - purchase window expired / no offer → My Products
     */
    async handlePostRegistrationNavigation(data, options = {}) {
      const {
        myProductsLink = "/pages/my-products",
        customerEmail = "",
        customerName = "",
        redirectDelayMs = 4500,
      } = options;

      const navigation = data?.postRegistrationNavigation || {};
      const offer = await this.resolveExtendedWarrantyOffer(data);
      const reason = offer?.reason || navigation.reason || null;
      const purchaseWindowExpired = reason === "purchase_window_expired";

      if (offer?.eligible && window.ExtendedWarrantyOffer) {
        try {
          const rendered = window.ExtendedWarrantyOffer.renderOffer(offer, {
            myProductsLink,
            customerEmail,
            customerName,
            onSkip: () => {
              this.clearPostRegistration();
              window.location.href = myProductsLink;
            },
          });
          if (rendered) return { shownOffer: true };
        } catch (err) {
          console.error("Extended warranty offer render failed:", err);
        }
      }

      this.clearPostRegistration();

      if (purchaseWindowExpired) {
        window.location.href = myProductsLink;
        return { redirected: true, reason: "purchase_window_expired" };
      }

      window.setTimeout(() => {
        window.location.href = myProductsLink;
      }, redirectDelayMs);

      return { redirected: true, delayed: true, reason: reason || "no_offer" };
    },

    async restoreExtendedWarrantyOffer(options = {}) {
      const state = this.getPostRegistration();
      if (!state?.registerId || !window.ExtendedWarrantyOffer) {
        return false;
      }

      try {
        const data = await fetchExtendedWarrantyOffer(state.registerId);

        if (!data.eligible) {
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
