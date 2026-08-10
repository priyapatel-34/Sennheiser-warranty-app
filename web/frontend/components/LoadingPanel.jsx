import { Spinner, Text } from "@shopify/polaris";

/**
 * Renders a lightweight loading placeholder while a page waits for data.
 */
export default function LoadingPanel({ label = "Loading..." }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 240,
        padding: 40,
      }}
    >
      <Spinner accessibilityLabel={label} size="large" />
      <div style={{ marginTop: 16 }}>
        <Text as="p" tone="subdued">
          {label}
        </Text>
      </div>
    </div>
  );
}
