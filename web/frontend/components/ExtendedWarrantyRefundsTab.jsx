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
    case "pending_review": return "attention";
    case "approved":       return "info";
    case "refunded":       return "success";
    case "rejected":
    case "cancelled":      return "critical";
    default:               return undefined;
  }
}

function formatStatusLabel(status) {
  return String(status || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
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

/* ── shared style helpers ─────────────────────────────────── */
const s = {
  stack: (gap = 16) => ({
    display: "flex",
    flexDirection: "column",
    gap,
  }),
  row: (gap = 12, align = "center") => ({
    display: "flex",
    alignItems: align,
    gap,
    flexWrap: "wrap",
  }),
  divider: {
    borderTop: "1px solid #e1e3e5",
    margin: "16px 0",
  },
  panel: {
    background: "#f9fafb",
    border: "1px solid #e1e3e5",
    borderRadius: 8,
    padding: "4px 14px",
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: "#6d7175",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    marginBottom: 8,
  },
};

/* ── small reusable detail field ──────────────────────────── */
function DetailField({ label, children }) {
  return (
    <div style={{ minWidth: 130 }}>
      <div style={s.sectionLabel}>{label}</div>
      <div style={{ fontSize: 14, color: "#202223" }}>{children || "—"}</div>
    </div>
  );
}

/* ── breakdown line ───────────────────────────────────────── */
function BreakdownRow({ label, value, bold }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "6px 0",
        borderBottom: bold ? "none" : "1px solid #f1f1f1",
        fontSize: 14,
        fontWeight: bold ? 600 : 400,
      }}
    >
      <span style={{ color: bold ? "#202223" : "#6d7175" }}>{label}</span>
      <span>{value}</span>
    </div>
  );
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
      {/* ── Single card: toolbar + table ── */}
      <LegacyCard>
        {/* Toolbar */}
        <div
          style={{
            ...s.row(10, "center"),
            justifyContent: "space-between",
            padding: "12px 16px",
            borderBottom: "1px solid #e1e3e5",
          }}
        >
          {/* Search + status */}
          <div style={{ ...s.row(10, "center"), flex: 1 }}>
            <div style={{ flex: 1, minWidth: 240, maxWidth: 420 }}>
              <TextField
                label="Search"
                labelHidden
                placeholder="Customer, email, serial, SKU, request ID…"
                value={searchInput}
                onChange={setSearchInput}
                clearButton
                onClearButtonClick={clearSearch}
                autoComplete="off"
                onKeyDown={(e) => e.key === "Enter" && runSearch()}
                connectedRight={
                  <Button onClick={runSearch}>Search</Button>
                }
              />
            </div>
            <div style={{ minWidth: 160 }}>
              <Select
                label="Status"
                labelHidden
                options={STATUS_OPTIONS}
                value={statusFilter}
                onChange={(v) => {
                  setPage(1);
                  setStatusFilter(v);
                }}
              />
            </div>
          </div>

          {/* Settings */}
          <Button
            onClick={() => {
              setSettingsOpen(true);
              loadSettings();
            }}
          >
            Refund settings
          </Button>
        </div>

        {/* Table body */}
        {loading ? (
          <LoadingPanel label="Loading refund requests..." />
        ) : refunds.length === 0 ? (
          <EmptyState heading="No refund requests" image="">
            <p>
              Refund requests appear here when a product return triggers an
              extended warranty cancellation.
            </p>
          </EmptyState>
        ) : (
          <>
            <IndexTable
              resourceName={{
                singular: "refund request",
                plural: "refund requests",
              }}
              itemCount={refunds.length}
              headings={[
                { title: "Request" },
                { title: "Customer" },
                { title: "Product" },
                { title: "Plan" },
                { title: "Net refund" },
                { title: "Status" },
                { title: "Created" },
                { title: "Actions" },
              ]}
              selectable={false}
            >
              {refunds.map((row, index) => (
                <IndexTable.Row
                  id={String(row.id)}
                  key={row.id}
                  position={index}
                >
                  <IndexTable.Cell>
                    <Text as="span" tone="subdued">
                      #{row.id}
                    </Text>
                  </IndexTable.Cell>

                  <IndexTable.Cell>
                    <div style={s.stack(1)}>
                      <Text as="span" fontWeight="semibold">
                        {row.customerName || "—"}
                      </Text>
                      <Text as="span" tone="subdued" variant="bodySm">
                        {row.customerEmail || ""}
                      </Text>
                    </div>
                  </IndexTable.Cell>

                  <IndexTable.Cell>
                    <div style={s.stack(1)}>
                      <span>{row.productName || "—"}</span>
                      {row.serialNumber && (
                        <Text as="span" tone="subdued" variant="bodySm">
                          SN: {row.serialNumber}
                        </Text>
                      )}
                    </div>
                  </IndexTable.Cell>

                  <IndexTable.Cell>{row.warrantyPlan || "—"}</IndexTable.Cell>

                  <IndexTable.Cell>
                    <Text as="span" fontWeight="semibold">
                      {formatMoney(row.netRefundAmount, row.currency)}
                    </Text>
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
                      loading={
                        detailLoading && selectedRefund?.id === row.id
                      }
                      onClick={() => loadRefundDetail(row.id)}
                    >
                      Review
                    </Button>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>

            {/* Pagination footer */}
            <div
              style={{
                ...s.row(12, "center"),
                justifyContent: "space-between",
                padding: "12px 16px",
                borderTop: "1px solid #e1e3e5",
              }}
            >
              <Text as="p" tone="subdued">
                {paginationMeta.total} request
                {paginationMeta.total === 1 ? "" : "s"}
                {showPagination
                  ? ` · Page ${page} of ${paginationMeta.totalPages}`
                  : ""}
              </Text>
              {showPagination && (
                <Pagination
                  hasPrevious={paginationMeta.hasPreviousPage}
                  onPrevious={() => setPage((p) => Math.max(1, p - 1))}
                  hasNext={paginationMeta.hasNextPage}
                  onNext={() => setPage((p) => p + 1)}
                  label={`Page ${page} of ${paginationMeta.totalPages}`}
                />
              )}
            </div>
          </>
        )}
      </LegacyCard>

      {/* ── Refund detail modal ── */}
      {selectedRefund && (
        <Modal
          open={detailOpen}
          onClose={() => setDetailOpen(false)}
          title={`Refund Request #${selectedRefund.id}`}
          primaryAction={
            selectedRefund.status === "pending_review"
              ? {
                  content: "Approve",
                  onAction: () =>
                    performAction("approve", { adminNotes }),
                  loading: actionLoading,
                }
              : selectedRefund.status === "approved"
              ? {
                  content: "Mark as refunded",
                  onAction: () =>
                    performAction("complete", { adminNotes }),
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
                          rejectReason ||
                          "Refund request rejected by finance",
                      }),
                    loading: actionLoading,
                  },
                ]
              : []),
            { content: "Close", onAction: () => setDetailOpen(false) },
          ]}
          large
        >
          <Modal.Section>
            <div style={s.stack(20)}>

              {/* Customer & product */}
              <div>
                <div style={s.sectionLabel}>Customer &amp; product</div>
                <div style={{ ...s.row(24, "flex-start"), flexWrap: "wrap" }}>
                  <DetailField label="Name">
                    {selectedRefund.customerName}
                  </DetailField>
                  <DetailField label="Email">
                    {selectedRefund.customerEmail}
                  </DetailField>
                  <DetailField label="Product">
                    {selectedRefund.productName}
                  </DetailField>
                  <DetailField label="Serial number">
                    {selectedRefund.serialNumber}
                  </DetailField>
                  <DetailField label="Warranty plan">
                    {selectedRefund.warrantyPlan}
                  </DetailField>
                  <DetailField label="Status">
                    <Badge tone={statusTone(selectedRefund.status)}>
                      {formatStatusLabel(selectedRefund.status)}
                    </Badge>
                  </DetailField>
                </div>
              </div>

              <div style={s.divider} />

              {/* Calculation breakdown */}
              <div>
                <div style={s.sectionLabel}>
                  Calculation breakdown
                  <span
                    style={{
                      marginLeft: 6,
                      fontWeight: 400,
                      textTransform: "none",
                      letterSpacing: 0,
                      color: "#8c9196",
                    }}
                  >
                    PRD §5.2
                  </span>
                </div>
                <div style={s.panel}>
                  <BreakdownRow
                    label="Original value"
                    value={formatMoney(
                      selectedRefund.purchasePrice,
                      selectedRefund.currency
                    )}
                  />
                  <BreakdownRow
                    label="Days total"
                    value={selectedRefund.daysTotal ?? "—"}
                  />
                  <BreakdownRow
                    label="Days used"
                    value={selectedRefund.daysUsed ?? 0}
                  />
                  <BreakdownRow
                    label="Used value"
                    value={
                      selectedRefund.usedValue != null
                        ? formatMoney(
                            selectedRefund.usedValue,
                            selectedRefund.currency
                          )
                        : "—"
                    }
                  />
                  <BreakdownRow
                    label="Remaining value"
                    value={
                      selectedRefund.remainingValue != null
                        ? formatMoney(
                            selectedRefund.remainingValue,
                            selectedRefund.currency
                          )
                        : "—"
                    }
                  />
                  <BreakdownRow
                    label="Pro-rata amount"
                    value={formatMoney(
                      selectedRefund.proRataRefundAmount,
                      selectedRefund.currency
                    )}
                  />
                  <BreakdownRow
                    label="Claim cost deducted"
                    value={formatMoney(
                      selectedRefund.claimCostDeducted || 0,
                      selectedRefund.currency
                    )}
                  />
                  <BreakdownRow
                    label="Net refund"
                    value={formatMoney(
                      selectedRefund.netRefundAmount,
                      selectedRefund.currency
                    )}
                    bold
                  />
                </div>
                {selectedRefund.calculationNotes && (
                  <div style={{ marginTop: 6 }}>
                    <Text as="p" tone="subdued" variant="bodySm">
                      {selectedRefund.calculationNotes}
                    </Text>
                  </div>
                )}
              </div>

              {/* Review fields — only when pending */}
              {selectedRefund.status === "pending_review" && (
                <>
                  <div style={s.divider} />
                  <div style={s.stack(12)}>
                    <div style={s.sectionLabel}>Review</div>
                    <TextField
                      label="Rejection reason"
                      helpText="Required only if rejecting."
                      value={rejectReason}
                      onChange={setRejectReason}
                      autoComplete="off"
                      placeholder="e.g. Outside eligibility window"
                    />
                    <TextField
                      label="Admin notes"
                      value={adminNotes}
                      onChange={setAdminNotes}
                      multiline={3}
                      autoComplete="off"
                      placeholder="Optional internal notes…"
                    />
                  </div>
                </>
              )}

              {/* Audit trail */}
              {selectedRefund.auditTrail?.length > 0 && (
                <>
                  <div style={s.divider} />
                  <div>
                    <div style={s.sectionLabel}>Audit trail</div>
                    <div style={s.panel}>
                      {selectedRefund.auditTrail.map((entry, i) => (
                        <div
                          key={i}
                          style={{
                            display: "flex",
                            gap: 16,
                            padding: "6px 0",
                            borderBottom:
                              i < selectedRefund.auditTrail.length - 1
                                ? "1px solid #f1f1f1"
                                : "none",
                            fontSize: 13,
                          }}
                        >
                          <span
                            style={{
                              color: "#6d7175",
                              whiteSpace: "nowrap",
                              minWidth: 150,
                            }}
                          >
                            {new Date(entry.createdAt).toLocaleString()}
                          </span>
                          <span style={{ color: "#202223" }}>
                            {entry.action}
                            {entry.actor && (
                              <span style={{ color: "#6d7175" }}>
                                {" "}by {entry.actor}
                              </span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </Modal.Section>
        </Modal>
      )}

      {/* ── Refund settings modal ── */}
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
            <div style={s.stack(16)}>
              {/* Behaviour group */}
              <div style={s.stack(10)}>
                <div style={s.sectionLabel}>Behaviour</div>
                <Checkbox
                  label="Refund processing enabled"
                  helpText="Allow refund requests to be created and processed."
                  checked={refundSettings.refundEnabled}
                  onChange={(v) =>
                    setRefundSettings((p) => ({ ...p, refundEnabled: v }))
                  }
                />
                <Checkbox
                  label="Pro-rata calculation enabled"
                  helpText="Calculate refunds based on remaining warranty period."
                  checked={refundSettings.proRataEnabled}
                  onChange={(v) =>
                    setRefundSettings((p) => ({ ...p, proRataEnabled: v }))
                  }
                />
              </div>

              <div style={s.divider} />

              {/* Notifications & limits group */}
              <div style={s.stack(12)}>
                <div style={s.sectionLabel}>Notifications &amp; limits</div>
                <TextField
                  label="Finance notification emails"
                  helpText="Comma-separated. Notified when a new refund request is created."
                  value={refundSettings.financeNotificationEmails}
                  onChange={(v) =>
                    setRefundSettings((p) => ({
                      ...p,
                      financeNotificationEmails: v,
                    }))
                  }
                  autoComplete="off"
                  placeholder="finance@example.com, ops@example.com"
                />
                <div style={{ maxWidth: 200 }}>
                  <TextField
                    label="Eligibility window (days)"
                    helpText="Leave blank for no limit."
                    type="number"
                    value={refundSettings.eligibilityWindowDays}
                    onChange={(v) =>
                      setRefundSettings((p) => ({
                        ...p,
                        eligibilityWindowDays: v,
                      }))
                    }
                    autoComplete="off"
                    placeholder="e.g. 30"
                  />
                </div>
              </div>

              {/* PRD note */}
              <div
                style={{
                  background: "#f9fafb",
                  border: "1px solid #e1e3e5",
                  borderRadius: 6,
                  padding: "8px 12px",
                }}
              >
                <Text as="p" tone="subdued" variant="bodySm">
                  Pro-rata formula is fixed per PRD Section 5.2 and cannot be
                  changed here.
                </Text>
              </div>
            </div>
          )}
        </Modal.Section>
      </Modal>
    </>
  );
}