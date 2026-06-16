import {
  LegacyCard,
  TextField,
  Button,
  IndexTable,
  Badge,
  Text,
  Modal,
  Select,
  Pagination,
  EmptyState,
  Checkbox,
} from "@shopify/polaris";
import { useEffect, useState } from "react";
import LoadingPanel from "../components/LoadingPanel.jsx";
import { useToast } from "../hooks/useToast.js";

const API_BASE = "/app/extended-warranty";
const PAGE_SIZE = 25;

const STATUS_OPTIONS = [
  { label: "All statuses", value: "all" },
  { label: "Pending Review", value: "pending_review" },
  { label: "Approved", value: "approved" },
  { label: "Rejected", value: "rejected" },
  { label: "Refunded", value: "refunded" },
  { label: "Cancelled", value: "cancelled" },
  { label: "Disputed", value: "disputed" },
];

function statusTone(status) {
  switch (status) {
    case "pending_review":
      return "attention";
    case "approved":
      return "info";
    case "refunded":
      return "success";
    case "rejected":
    case "cancelled":
      return "critical";
    default:
      return undefined;
  }
}

function formatStatusLabel(status) {
  return String(status || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

function formatMoney(amount, currency) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
    }).format(Number(amount));
  } catch {
    return `${Number(amount).toFixed(2)} ${currency || ""}`.trim();
  }
}

export default function ExtendedWarrantyRefundsTab() {
  const toast = useToast();
  const [refunds, setRefunds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [paginationMeta, setPaginationMeta] = useState({
    total: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  });

  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedRefund, setSelectedRefund] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [adminNotes, setAdminNotes] = useState("");

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [refundSettings, setRefundSettings] = useState({
    refundEnabled: true,
    proRataEnabled: true,
    cancelOnRefund: true,
    autoCancelEntitlement: true,
    financeNotificationEmails: "",
    eligibilityWindowDays: "",
  });

  const loadRefunds = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
        status: statusFilter,
      });
      if (searchQuery) params.set("q", searchQuery);

      const r = await fetch(`${API_BASE}/refunds?${params.toString()}`);
      if (!r.ok) throw new Error();
      const data = await r.json();
      setRefunds(Array.isArray(data.data) ? data.data : []);
      const meta = data.pagination || {};
      setPaginationMeta({
        total: meta.total || 0,
        totalPages: meta.totalPages || 1,
        hasNextPage: Boolean(meta.hasNextPage),
        hasPreviousPage: Boolean(meta.hasPreviousPage),
      });
    } catch {
      toast.showError("Unable to load refund requests");
      setRefunds([]);
    } finally {
      setLoading(false);
    }
  };

  const loadRefundDetail = async id => {
    setDetailLoading(true);
    try {
      const r = await fetch(`${API_BASE}/refunds/${id}`);
      if (!r.ok) throw new Error();
      const data = await r.json();
      setSelectedRefund(data.refund);
      setDetailOpen(true);
    } catch {
      toast.showError("Unable to load refund details");
    } finally {
      setDetailLoading(false);
    }
  };

  const loadSettings = async () => {
    setSettingsLoading(true);
    try {
      const r = await fetch(`${API_BASE}/refunds/settings`);
      if (!r.ok) throw new Error();
      const data = await r.json();
      const s = data.settings || {};
      setRefundSettings({
        refundEnabled: Boolean(s.refundEnabled),
        proRataEnabled: Boolean(s.proRataEnabled),
        cancelOnRefund: Boolean(s.cancelOnRefund),
        autoCancelEntitlement: Boolean(s.autoCancelEntitlement),
        financeNotificationEmails: s.financeNotificationEmails || "",
        eligibilityWindowDays:
          s.eligibilityWindowDays != null ? String(s.eligibilityWindowDays) : "",
      });
    } catch {
      toast.showError("Unable to load refund settings");
    } finally {
      setSettingsLoading(false);
    }
  };

  useEffect(() => {
    loadRefunds();
  }, [page, statusFilter, searchQuery]);

  const runSearch = () => {
    setPage(1);
    setSearchQuery(searchInput.trim());
  };

  const clearSearch = () => {
    setSearchInput("");
    setSearchQuery("");
    setPage(1);
  };

  const performAction = async (action, body = {}) => {
    if (!selectedRefund?.id) return;
    setActionLoading(true);
    try {
      const r = await fetch(`${API_BASE}/refunds/${selectedRefund.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Action failed");
      toast.showSuccess(`Refund ${action} successful`);
      setDetailOpen(false);
      setSelectedRefund(null);
      setRejectReason("");
      setAdminNotes("");
      loadRefunds();
    } catch (err) {
      toast.showError(err.message || "Action failed");
    } finally {
      setActionLoading(false);
    }
  };

  const saveSettings = async () => {
    setSettingsSaving(true);
    try {
      const r = await fetch(`${API_BASE}/refunds/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...refundSettings,
          eligibilityWindowDays: refundSettings.eligibilityWindowDays
            ? Number(refundSettings.eligibilityWindowDays)
            : null,
        }),
      });
      if (!r.ok) throw new Error();
      toast.showSuccess("Refund settings saved");
      setSettingsOpen(false);
    } catch {
      toast.showError("Failed to save refund settings");
    } finally {
      setSettingsSaving(false);
    }
  };

  const showPagination = !loading && paginationMeta.totalPages > 1;

  return (
    <>
      <LegacyCard sectioned>
        <div align="space-between" blockAlign="center" wrap>
          <Button onClick={() => { setSettingsOpen(true); loadSettings(); }}>
            Refund settings
          </Button>
          <Button
            onClick={() => {
              const params = new URLSearchParams({ status: statusFilter });
              if (searchQuery) params.set("q", searchQuery);
              window.open(
                `${API_BASE}/refunds/export?${params.toString()}`,
                "_blank"
              );
            }}
          >
            Export CSV
          </Button>
        </div>
      </LegacyCard>

      <LegacyCard>
        <div style={{ padding: "16px 16px 0" }}>
          <div gap="300" wrap blockAlign="end">
            <div style={{ flex: 1, minWidth: 240 }}>
              <form
                onSubmit={e => {
                  e.preventDefault();
                  runSearch();
                }}
              >
                <TextField
                  label="Search refund requests"
                  labelHidden
                  placeholder="Customer, email, serial, SKU, request ID..."
                  value={searchInput}
                  onChange={setSearchInput}
                  clearButton
                  onClearButtonClick={clearSearch}
                  autoComplete="off"
                  connectedRight={<Button onClick={runSearch}>Search</Button>}
                />
              </form>
            </div>
            <Select
              label="Status"
              options={STATUS_OPTIONS}
              value={statusFilter}
              onChange={v => {
                setPage(1);
                setStatusFilter(v);
              }}
            />
          </div>
        </div>

        {loading ? (
          <LoadingPanel label="Loading refund requests..." />
        ) : refunds.length === 0 ? (
          <EmptyState heading="No refund requests" image="">
            <p>Refund requests appear here when a product return triggers an extended warranty cancellation.</p>
          </EmptyState>
        ) : (
          <>
            <IndexTable
              resourceName={{ singular: "refund request", plural: "refund requests" }}
              itemCount={refunds.length}
              headings={[
                { title: "Request ID" },
                { title: "Customer" },
                { title: "Product" },
                { title: "Plan" },
                { title: "Refund amount" },
                { title: "Status" },
                { title: "Created" },
                { title: "Actions" },
              ]}
              selectable={false}
            >
              {refunds.map((row, index) => (
                <IndexTable.Row id={String(row.id)} key={row.id} position={index}>
                  <IndexTable.Cell>#{row.id}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" fontWeight="semibold">
                      {row.customerName || "—"}
                    </Text>
                    <br />
                    <Text as="span" tone="subdued">
                      {row.customerEmail || "—"}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {row.productName || "—"}
                    {row.serialNumber ? (
                      <>
                        <br />
                        <Text as="span" tone="subdued">
                          SN: {row.serialNumber}
                        </Text>
                      </>
                    ) : null}
                  </IndexTable.Cell>
                  <IndexTable.Cell>{row.warrantyPlan || "—"}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {formatMoney(row.netRefundAmount, row.currency)}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge tone={statusTone(row.status)}>
                      {formatStatusLabel(row.status)}
                    </Badge>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {row.createdAt
                      ? new Date(row.createdAt).toLocaleDateString()
                      : "—"}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Button
                      size="slim"
                      loading={detailLoading && selectedRefund?.id === row.id}
                      onClick={() => loadRefundDetail(row.id)}
                    >
                      Review
                    </Button>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>

            <div
              style={{
                padding: 16,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 12,
              }}
            >
              <Text as="p" tone="subdued">
                {paginationMeta.total} request
                {paginationMeta.total === 1 ? "" : "s"}
                {showPagination
                  ? ` · Page ${page} of ${paginationMeta.totalPages}`
                  : ""}
              </Text>
              {showPagination ? (
                <Pagination
                  hasPrevious={paginationMeta.hasPreviousPage}
                  onPrevious={() => setPage(p => Math.max(1, p - 1))}
                  hasNext={paginationMeta.hasNextPage}
                  onNext={() => setPage(p => p + 1)}
                  label={`Page ${page} of ${paginationMeta.totalPages}`}
                />
              ) : null}
            </div>
          </>
        )}
      </LegacyCard>

      {selectedRefund && (
        <Modal
          open={detailOpen}
          onClose={() => setDetailOpen(false)}
          title={`Refund Request #${selectedRefund.id}`}
          primaryAction={
            selectedRefund.status === "pending_review"
              ? {
                  content: "Approve",
                  onAction: () => performAction("approve", { adminNotes }),
                  loading: actionLoading,
                }
              : selectedRefund.status === "approved"
                ? {
                    content: "Mark as refunded",
                    onAction: () => performAction("complete", { adminNotes }),
                    loading: actionLoading,
                  }
                : undefined
          }
          secondaryActions={[
            ...(selectedRefund.status === "pending_review"
              ? [
                  {
                    content: "Reject",
                    destructive: true,
                    onAction: () =>
                      performAction("reject", {
                        rejectionReason:
                          rejectReason || "Refund request rejected by finance",
                      }),
                    loading: actionLoading,
                  },
                ]
              : []),
            {
              content: "Close",
              onAction: () => setDetailOpen(false),
            },
          ]}
          large
        >
          <Modal.Section>
            <Text as="h3" variant="headingSm">
              Customer & product
            </Text>
            <Text as="p">
              {selectedRefund.customerName} · {selectedRefund.customerEmail}
              <br />
              {selectedRefund.productName} · SN {selectedRefund.serialNumber || "—"}
              <br />
              Plan: {selectedRefund.warrantyPlan}
            </Text>

            <div style={{ marginTop: 16 }}>
              <Text as="h3" variant="headingSm">
                Calculation breakdown (PRD §5.2)
              </Text>
              <Text as="p" tone="subdued">
                Original value: {formatMoney(selectedRefund.purchasePrice, selectedRefund.currency)}
                <br />
                Used value:{" "}
                {selectedRefund.usedValue != null
                  ? formatMoney(selectedRefund.usedValue, selectedRefund.currency)
                  : "—"}
                <br />
                Remaining value:{" "}
                {selectedRefund.remainingValue != null
                  ? formatMoney(selectedRefund.remainingValue, selectedRefund.currency)
                  : "—"}
                <br />
                Days total: {selectedRefund.daysTotal ?? "—"} · Days used:{" "}
                {selectedRefund.daysUsed ?? 0}
                <br />
                Pro-rata amount:{" "}
                {formatMoney(
                  selectedRefund.proRataRefundAmount,
                  selectedRefund.currency
                )}
                <br />
                Claim cost deducted:{" "}
                {formatMoney(
                  selectedRefund.claimCostDeducted || 0,
                  selectedRefund.currency
                )}
                <br />
                <strong>
                  Net refund:{" "}
                  {formatMoney(selectedRefund.netRefundAmount, selectedRefund.currency)}
                </strong>
              </Text>
              {selectedRefund.calculationNotes ? (
                <Text as="p" tone="subdued">
                  {selectedRefund.calculationNotes}
                </Text>
              ) : null}
            </div>

            {selectedRefund.status === "pending_review" ? (
              <div style={{ marginTop: 16 }}>
                <TextField
                  label="Rejection reason (if rejecting)"
                  value={rejectReason}
                  onChange={setRejectReason}
                  autoComplete="off"
                />
                <TextField
                  label="Admin notes"
                  value={adminNotes}
                  onChange={setAdminNotes}
                  multiline={3}
                  autoComplete="off"
                />
              </div>
            ) : null}

            {selectedRefund.auditTrail?.length ? (
              <div style={{ marginTop: 16 }}>
                <Text as="h3" variant="headingSm">
                  Audit trail
                </Text>
                {selectedRefund.auditTrail.map((entry, i) => (
                  <Text as="p" tone="subdued" key={i}>
                    {new Date(entry.createdAt).toLocaleString()} — {entry.action}{" "}
                    {entry.actor ? `by ${entry.actor}` : ""}
                  </Text>
                ))}
              </div>
            ) : null}
          </Modal.Section>
        </Modal>
      )}

      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Refund settings"
        primaryAction={{
          content: "Save",
          onAction: saveSettings,
          loading: settingsSaving,
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setSettingsOpen(false) },
        ]}
      >
        <Modal.Section>
          {settingsLoading ? (
            <LoadingPanel label="Loading settings..." />
          ) : (
            <>
              <Checkbox
                label="Refund processing enabled"
                checked={refundSettings.refundEnabled}
                onChange={v => setRefundSettings(p => ({ ...p, refundEnabled: v }))}
              />
              <Checkbox
                label="Pro-rata calculation enabled"
                checked={refundSettings.proRataEnabled}
                onChange={v => setRefundSettings(p => ({ ...p, proRataEnabled: v }))}
              />
              <Checkbox
                label="Auto-cancel entitlement on refund request"
                checked={refundSettings.autoCancelEntitlement}
                onChange={v =>
                  setRefundSettings(p => ({ ...p, autoCancelEntitlement: v }))
                }
              />
              <TextField
                label="Finance notification emails"
                helpText="Comma-separated emails notified when a new refund request is created"
                value={refundSettings.financeNotificationEmails}
                onChange={v =>
                  setRefundSettings(p => ({ ...p, financeNotificationEmails: v }))
                }
                autoComplete="off"
              />
              <TextField
                label="Refund eligibility window (days)"
                helpText="Optional. Leave blank for no window limit."
                type="number"
                value={refundSettings.eligibilityWindowDays}
                onChange={v =>
                  setRefundSettings(p => ({ ...p, eligibilityWindowDays: v }))
                }
                autoComplete="off"
              />
              <Text as="p" tone="subdued">
                Pro-rata formula is fixed per PRD Section 5.2 and cannot be changed.
              </Text>
            </>
          )}
        </Modal.Section>
      </Modal>
    </>
  );
}
