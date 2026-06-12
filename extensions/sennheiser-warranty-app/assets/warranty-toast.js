(() => {
  const TOAST_DURATION_MS = 4000;

  function ensureContainer() {
    let container = document.getElementById("warranty-toast-container");
    if (container) return container;

    container = document.createElement("div");
    container.id = "warranty-toast-container";
    container.className = "warranty-toast-container";
    document.body.appendChild(container);
    return container;
  }

  function showToast(message, type = "success") {
    if (!message) return;

    const container = ensureContainer();
    const toast = document.createElement("div");
    toast.className = `warranty-toast warranty-toast-${type}`;
    toast.setAttribute("role", "status");
    toast.textContent = message;
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add("show"));

    window.setTimeout(() => {
      toast.classList.remove("show");
      window.setTimeout(() => toast.remove(), 300);
    }, TOAST_DURATION_MS);
  }

  window.WarrantyToast = {
    showSuccess: message => showToast(message, "success"),
    showError: message => showToast(message, "error"),
  };
})();
