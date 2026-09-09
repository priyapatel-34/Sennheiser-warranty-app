// Shared registration form helpers for serial validation, consent, and submit.
window.WarrantyForm = {
  showError(el, msg) {
    if (!el) return;
    const err = el.closest(".form-input")?.querySelector(".field-error");
    if (err) err.textContent = msg;
    el.classList.add("has-error");
  },

  clearError(el) {
    if (!el) return;
    const err = el.closest(".form-input")?.querySelector(".field-error");
    if (err) err.textContent = "";
    el.classList.remove("has-error");
  },

  scrollToError(el) {
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.focus?.();
  },

  validateSerial(input, silent = false, messages = {}) {
    const value = input.value.trim();
    const text = {
      required: "Serial number is required",
      charset: "Serial number must contain only letters and numbers",
      min: "Serial number must be at least 10 characters",
      max: "Serial number must not exceed 20 characters",
      ...messages,
    };

    if (!value) {
      if (!silent) this.showError(input, text.required);
      return false;
    }
    if (!/^[a-zA-Z0-9]+$/.test(value)) {
      if (!silent) this.showError(input, text.charset);
      return false;
    }
    if (value.length < 10) {
      if (!silent) this.showError(input, text.min);
      return false;
    }
    if (value.length > 20) {
      if (!silent) this.showError(input, text.max);
      return false;
    }

    this.clearError(input);
    return true;
  },

  clearErrorOnInput() {
    document.addEventListener("input", (e) => {
      if (e.target.classList.contains("has-error")) {
        this.clearError(e.target);
      }
    });
  },

  bindConsentClear(consent1, consent2, privacyError, confirmError) {
    consent1?.addEventListener("change", () => {
      if (consent1.checked && privacyError) privacyError.textContent = "";
    });
    consent2?.addEventListener("change", () => {
      if (consent2.checked && confirmError) confirmError.textContent = "";
    });
  },

  validateConsents(consent1, consent2, privacyError, confirmError) {
    let valid = true;
    let firstError = null;
    if (privacyError) privacyError.textContent = "";
    if (confirmError) confirmError.textContent = "";

    if (!consent1?.checked) {
      if (privacyError) privacyError.textContent = "You must accept the privacy notice.";
      valid = false;
      firstError = consent1;
    }
    if (!consent2?.checked) {
      if (confirmError) confirmError.textContent = "You must confirm your information.";
      valid = false;
      firstError ??= consent2;
    }

    return { valid, firstError };
  },

  attachSerialLiveValidation(root, validateSerial) {
    const scope = root?.querySelectorAll ? root : document;
    scope.querySelectorAll("[data-serial]").forEach((input) => {
      input.addEventListener("input", () => {
        this.clearError(input);
        if (input.value.trim().length >= 10) {
          validateSerial(input, true);
        }
      });
    });
  },

  async submitRegistration(payload) {
    const res = await fetch("/apps/warranty/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  },

  resetSubmit(submitBtn) {
    window.ExtendedWarrantyOffer?.hidePageLoader?.();
    window.ExtendedWarrantyOffer?.showRegistrationForm?.();
    if (submitBtn) submitBtn.disabled = false;
  },
};
