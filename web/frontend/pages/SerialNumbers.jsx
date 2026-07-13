import {
  Page,
  LegacyCard,
  Button,
  Modal,
  DropZone,
  DataTable,
  Text,
  Tabs,
  TextField,
  Checkbox,
  Link,
  Pagination,
  Banner,
  EmptyState,
} from "@shopify/polaris";
import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import LoadingPanel from "../components/LoadingPanel.jsx";
import { useToast } from "../hooks/useToast.js";
import { formatDate } from "../utils/formatDate.js";

const DEFAULT_PAGE_SIZE = 25;

function displayCell(value) {
  if (value == null || String(value).trim() === "") return "-";
  return String(value).trim();
}

function extractSerialsFromSheet(rows) {
  return rows
    .map((row) => {
      const key = Object.keys(row).find((k) => /serial/i.test(k));
      const value = key ? row[key] : Object.values(row)[0];
      return String(value ?? "").trim();
    })
    .filter(Boolean);
}

export default function SerialNumbers() {
  const toast = useToast();
  const [selectedTab, setSelectedTab] = useState(0);
  const [rows, setRows] = useState([]);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = DEFAULT_PAGE_SIZE;
  const [paginationMeta, setPaginationMeta] = useState({
    total: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  });
  const [loading, setLoading] = useState(false);
  const [openImport, setOpenImport] = useState(false);
  const [preview, setPreview] = useState([]);
  const [importing, setImporting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [manualSerial, setManualSerial] = useState("");
  const [addingManual, setAddingManual] = useState(false);
  const [verificationEnabled, setVerificationEnabled] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const toastRef = useRef(toast);
  toastRef.current = toast;

  async function loadSerialNumbers({
    targetPage = page,
    search = searchQuery,
    limit = pageSize,
  } = {}) {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(targetPage),
        limit: String(limit),
      });
      if (search) params.set("q", search);

      const response = await fetch(`/app/serial-numbers/?${params.toString()}`, {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      const serialRows = Array.isArray(data.serialNumbers) ? data.serialNumbers : [];
      setRows(serialRows);

      const meta = data.pagination || {};
      setPaginationMeta({
        total: meta.total || 0,
        totalPages: meta.totalPages || 1,
        hasNextPage: Boolean(meta.hasNextPage),
        hasPreviousPage: Boolean(meta.hasPreviousPage),
      });
      if (meta.page && meta.page !== targetPage) {
        setPage(meta.page);
      }
    } catch (err) {
      console.error("Failed to load serial numbers:", err);
      setRows([]);
      toastRef.current.showError("Failed to load serial numbers");
    } finally {
      setLoading(false);
    }
  }

  async function loadSettings() {
    try {
      const r = await fetch("/app/settings/serialVerification", {
        credentials: "include",
      });
      const data = await r.json();
      setVerificationEnabled(Boolean(data.serial_verification_enabled));
    } catch (err) {
      console.error("Failed to load serial verification setting:", err);
    }
  }

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    if (selectedTab !== 0) return;
    loadSerialNumbers({ targetPage: page, search: searchQuery, limit: pageSize });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTab, page, searchQuery, pageSize]);

  const resetImportState = () => setPreview([]);

  const openImportModal = () => {
    resetImportState();
    setOpenImport(true);
  };

  const closeImportModal = () => {
    setOpenImport(false);
    resetImportState();
  };

  const runSearch = () => {
    setPage(1);
    setSearchQuery(searchInput.trim());
  };

  const clearSearch = () => {
    setSearchInput("");
    setSearchQuery("");
    setPage(1);
  };

  const showPagination = !loading && paginationMeta.total > 0;

  function downloadSample() {
    const csv = "Serial Number\nSN-0001234\nSN-0005678\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "serial-numbers-sample.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function handleDrop(files) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const wb = XLSX.read(e.target.result, { type: "binary" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      setPreview(extractSerialsFromSheet(data));
    };
    reader.readAsBinaryString(files[0]);
  }

  async function saveImport() {
    if (!preview.length) return;
    setImporting(true);
    try {
      const response = await fetch("/app/serial-numbers/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ serials: preview }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Import failed");

      const parts = [`Imported ${data.imported || 0} serial number(s)`];
      if (data.alreadyExisted) parts.push(`${data.alreadyExisted} already existed`);
      if (data.duplicateRows) parts.push(`${data.duplicateRows} duplicate rows skipped`);
      if (data.invalidRows) parts.push(`${data.invalidRows} invalid rows skipped`);
      if (data.emptyRows) parts.push(`${data.emptyRows} empty rows skipped`);
      toast.showSuccess(parts.join(", "));

      closeImportModal();
      setPage(1);
      loadSerialNumbers({ targetPage: 1, search: searchQuery, limit: pageSize });
    } catch (err) {
      toast.showError(err.message || "Import failed");
    } finally {
      setImporting(false);
    }
  }

  async function addManualSerial() {
    const value = manualSerial.trim();
    if (!value) return;
    setAddingManual(true);
    try {
      const response = await fetch("/app/serial-numbers/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ serial_number: value }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to add serial number");

      toast.showSuccess(`Added serial number "${data.serial_number}"`);
      setManualSerial("");
      setPage(1);
      loadSerialNumbers({ targetPage: 1, search: searchQuery, limit: pageSize });
    } catch (err) {
      toast.showError(err.message || "Failed to add serial number");
    } finally {
      setAddingManual(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget?.id) return;
    setDeleting(true);
    try {
      const response = await fetch(`/app/serial-numbers/${deleteTarget.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Delete failed");

      setRows((prev) => prev.filter((row) => row.id !== deleteTarget.id));
      setPaginationMeta((prev) => ({
        ...prev,
        total: Math.max(0, prev.total - 1),
      }));
      toast.showSuccess("Serial number deleted");
      setDeleteTarget(null);
      loadSerialNumbers({ targetPage: page, search: searchQuery, limit: pageSize });
    } catch (err) {
      toast.showError(err.message || "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  async function handleVerificationToggle(value) {
    setVerificationEnabled(value);
    setSettingsLoading(true);
    try {
      const response = await fetch("/app/settings/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ serial_verification_enabled: value ? 1 : 0 }),
      });
      if (!response.ok) throw new Error("Failed to save setting");
    } catch (err) {
      setVerificationEnabled(!value);
      toast.showError("Failed to save setting");
    } finally {
      setSettingsLoading(false);
    }
  }

  const tableRows = rows.map((r) => [
    displayCell(r.serial_number),
    formatDate(r.imported_at),
    <div className="wa-table-actions" key={`actions-${r.id}`}>
      <Button size="slim" tone="critical" onClick={() => setDeleteTarget(r)}>
        Delete
      </Button>
    </div>,
  ]);

  return (
    <Page
      title="Serial Number Verification"
      primaryAction={{
        content: "Import CSV",
        onAction: openImportModal,
      }}
    >
      <Tabs
        tabs={[
          { id: "serials", content: "Serial Numbers" },
          { id: "settings", content: "Settings" },
        ]}
        selected={selectedTab}
        onSelect={setSelectedTab}
      />

      {selectedTab === 0 && (
        <LegacyCard sectioned>
          <div className="wa-stack-12">
            {!verificationEnabled ? (
              <Banner tone="warning">
                Serial number verification is currently OFF. Imported serial
                numbers are stored, but registration will not require them
                until you enable the setting on the Settings tab.
              </Banner>
            ) : null}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                runSearch();
              }}
              className="wa-compact-form-row"
            >
              <div className="wa-compact-form-row__field">
                <TextField
                  label="Search serial numbers"
                  labelHidden
                  placeholder="Search by serial number"
                  value={searchInput}
                  onChange={setSearchInput}
                  clearButton
                  onClearButtonClick={clearSearch}
                  autoComplete="off"
                  connectedRight={<Button onClick={runSearch}>Search</Button>}
                />
              </div>
            </form>

            <div className="wa-compact-form-row">
              <div className="wa-compact-form-row__field">
                <TextField
                  label="Add a serial number"
                  labelHidden
                  placeholder="Add a single serial number"
                  value={manualSerial}
                  onChange={setManualSerial}
                  autoComplete="off"
                  connectedRight={
                    <Button
                      onClick={addManualSerial}
                      loading={addingManual}
                      disabled={!manualSerial.trim()}
                    >
                      Add
                    </Button>
                  }
                />
              </div>
            </div>

            <Link removeUnderline onClick={downloadSample}>
              Download sample CSV
            </Link>

            {loading ? (
              <LoadingPanel label="Loading serial numbers..." />
            ) : rows.length === 0 ? (
              <EmptyState
                heading="No serial numbers found"
                image=""
                action={{
                  content: "Import serial numbers",
                  onAction: openImportModal,
                }}
              >
                <p>Import serial numbers or adjust your search filters.</p>
              </EmptyState>
            ) : (
              <div className="wa-table-scroll">
                <DataTable
                  columnContentTypes={["text", "text", "text"]}
                  headings={["Serial number", "Imported at", "Actions"]}
                  rows={tableRows}
                />
              </div>
            )}

            {showPagination ? (
              <div className="wa-pagination-bar">
                <Text as="p" tone="subdued">
                  {paginationMeta.total} serial number
                  {paginationMeta.total === 1 ? "" : "s"}
                  {searchQuery ? ` matching "${searchQuery}"` : ""}
                  {` · Page ${page} of ${paginationMeta.totalPages}`}
                </Text>
                <div className="wa-pagination-bar__controls">
                  <Button disabled={page <= 1} onClick={() => setPage(1)}>
                    First
                  </Button>
                  <Pagination
                    hasPrevious={paginationMeta.hasPreviousPage}
                    onPrevious={() => setPage((p) => Math.max(1, p - 1))}
                    hasNext={paginationMeta.hasNextPage}
                    onNext={() => setPage((p) => p + 1)}
                    label={`Page ${page} of ${paginationMeta.totalPages}`}
                  />
                  <Button
                    disabled={page >= paginationMeta.totalPages}
                    onClick={() => setPage(paginationMeta.totalPages)}
                  >
                    Last
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </LegacyCard>
      )}

      {selectedTab === 1 && (
        <LegacyCard sectioned>
          <div className="wa-stack-12">
            <Text variant="headingMd">Serial Number Verification</Text>
            <Checkbox
              label="Enable serial number verification for this store"
              checked={verificationEnabled}
              onChange={handleVerificationToggle}
              disabled={settingsLoading}
            />
            <Text as="p" tone="subdued">
              When enabled, customers can only register a product using a
              serial number that has been imported below. Existing stores
              default to OFF, so registration behaves exactly as before
              unless you turn this on.
            </Text>
          </div>
        </LegacyCard>
      )}

      <Modal
        open={openImport}
        onClose={closeImportModal}
        title="Import serial numbers"
        primaryAction={{
          content: "Upload and save",
          onAction: saveImport,
          disabled: !preview.length,
          loading: importing,
        }}
        secondaryActions={[{ content: "Cancel", onAction: closeImportModal }]}
      >
        <Modal.Section>
          <div className="wa-stack-12">
            <Banner tone="info">
              The file must contain a column named "Serial Number". Empty
              rows, duplicate rows, and serial numbers already imported for
              this store will be skipped automatically.
            </Banner>
            <DropZone accept=".csv,.xlsx" onDrop={handleDrop}>
              <DropZone.FileUpload />
            </DropZone>
            <Link removeUnderline onClick={downloadSample}>
              Download sample CSV
            </Link>
            {preview.length > 0 ? (
              <div className="wa-table-scroll">
                <DataTable
                  columnContentTypes={["text"]}
                  headings={[`Serial number (${preview.length} row(s) found)`]}
                  rows={preview.map((s) => [s])}
                />
              </div>
            ) : null}
          </div>
        </Modal.Section>
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete serial number"
        primaryAction={{
          content: "Delete",
          destructive: true,
          loading: deleting,
          onAction: confirmDelete,
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setDeleteTarget(null) },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            Are you sure you want to delete{" "}
            <strong>{displayCell(deleteTarget?.serial_number)}</strong>? This
            action cannot be undone.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
