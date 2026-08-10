import { useState } from "react";
import { Card, TextContainer, Text } from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useTranslation } from "react-i18next";
import { useQuery } from "react-query";

/**
 * Renders the demo product population card used on the landing page to exercise
 * the Products API and show a simple loading/refetch cycle.
 */
export function ProductsCard() {
  const shopify = useAppBridge();
  const { t } = useTranslation();
  const [isPopulating, setIsPopulating] = useState(false);
  const productsCount = 5;

  const {
    data,
    refetch: refetchProductCount,
    isLoading: isLoadingCount,
  } = useQuery({
    queryKey: ["productCount"],
    queryFn: async () => {
      const response = await fetch("/api/products/count");
      return await response.json();
    },
    refetchOnWindowFocus: false,
  });

  /**
   * Keeps the Shopify loading indicator and local component state aligned while
   * the populate flow is running.
   */
  const setPopulating = (flag) => {
    shopify.loading(flag);
    setIsPopulating(flag);
  };

  /**
   * Creates demo products through the backend API and refreshes the displayed
   * count once the request succeeds.
   */
  const handlePopulate = async () => {
    setPopulating(true);
    const response = await fetch("/api/products", { method: "POST" });

    if (response.ok) {
      await refetchProductCount();

      shopify.toast.show(
        t("ProductsCard.productsCreatedToast", { count: productsCount })
      );
    } else {
      shopify.toast.show(t("ProductsCard.errorCreatingProductsToast"), {
        isError: true,
      });
    }

    setPopulating(false);
  };

  return (
    <Card
      title={t("ProductsCard.title")}
      sectioned
      primaryFooterAction={{
        content: t("ProductsCard.populateProductsButton", {
          count: productsCount,
        }),
        onAction: handlePopulate,
        loading: isPopulating,
      }}
    >
      <TextContainer spacing="loose">
        <p>{t("ProductsCard.description")}</p>
        <Text as="h4" variant="headingMd">
          {t("ProductsCard.totalProductsHeading")}
          <Text variant="bodyMd" as="p" fontWeight="semibold">
            {isLoadingCount ? "-" : data?.count}
          </Text>
        </Text>
      </TextContainer>
    </Card>
  );
}
