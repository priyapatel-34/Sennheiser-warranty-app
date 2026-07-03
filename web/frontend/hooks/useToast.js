import { useMemo } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";

/** Shopify admin toast (bottom-right, ~4s). */
export function useToast() {
  const shopify = useAppBridge();

  return useMemo(
    () => ({
      showSuccess(message) {
        shopify.toast.show(message, { duration: 4000 });
      },
      showError(message) {
        shopify.toast.show(message, { isError: true, duration: 4000 });
      },
    }),
    [shopify]
  );
}
