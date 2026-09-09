// Shared admin list pagination: First / previous / next / Last.
import { Button, Pagination, Text } from "@shopify/polaris";

export default function ListPagination({
  page,
  totalPages,
  total,
  noun,
  extraText = "",
  show,
  hasPrevious,
  hasNext,
  onFirst,
  onPrevious,
  onNext,
  onLast,
  firstDisabled,
  lastDisabled,
}) {
  const visible = show ?? totalPages > 1;
  const countLabel = `${total} ${noun}${total === 1 ? "" : "s"}${extraText}${
    visible ? ` · Page ${page} of ${totalPages}` : ""
  }`;

  return (
    <div className="wa-pagination-bar" style={{ padding: 16 }}>
      <Text as="p" tone="subdued">
        {countLabel}
      </Text>
      {visible ? (
        <div className="wa-pagination-bar__controls">
          <Button disabled={firstDisabled ?? page <= 1} onClick={onFirst}>
            First
          </Button>
          <Pagination
            hasPrevious={hasPrevious}
            onPrevious={onPrevious}
            hasNext={hasNext}
            onNext={onNext}
            label={`Page ${page} of ${totalPages}`}
          />
          <Button
            disabled={lastDisabled ?? page >= totalPages}
            onClick={onLast}
          >
            Last
          </Button>
        </div>
      ) : null}
    </div>
  );
}
