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

const DEFAULT_PAGE_SIZE = 25;

function displayCell(value) {
  if (value == null || String(value).trim() === "") return "-";
  return String(value).trim();
}

export default function Retailers() {
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
  const [editRetailer, setEditRetailer] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [retailerRequired, setRetailerRequired] = useState(false);
  const toastRef = useRef(toast);
  toastRef.current = toast;

  async function loadRetailers({
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

      const response = await fetch(`/app/retailers/?${params.toString()}`, {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      const retailerRows = Array.isArray(data.retailers) ? data.retailers : [];
      setRows(retailerRows);

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
      console.error("Failed to load retailers:", err);
      setRows([]);
      toastRef.current.showError("Failed to load retailers");
    } finally {
      setLoading(false);
    }
  }

  async function loadSettings() {
    const r = await fetch("/app/settings/requiredRetailer", { credentials: "include" });
    const data = await r.json();
    setRetailerRequired(Boolean(data.retailer_required));
  }

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    if (selectedTab !== 0) return;
    loadRetailers({ targetPage: page, search: searchQuery, limit: pageSize });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTab, page, searchQuery, pageSize]);

  const resetImportState = () => {
    setPreview([]);
  };

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
    const ws = XLSX.utils.json_to_sheet([
      {
        "Retailer Name": "Amazon",
        City: "Mumbai",
        "Localized Name": "アマゾン",
      },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Retailers");
    XLSX.writeFile(wb, "retailers-sample.xlsx");
  }

  function handleDrop(files) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const wb = XLSX.read(e.target.result, { type: "binary" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(sheet);

      setPreview(
        data.map((r) => [
          displayCell(r["Retailer Name"]),
          displayCell(r["Localized Name"] ?? r["Retailer JA"]),
          displayCell(r.City),
        ])
      );
    };
    reader.readAsBinaryString(files[0]);
  }

  async function saveRetailers() {
    if (!preview.length) return;
    setImporting(true);
    try {
      const response = await fetch("/app/retailers/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          retailers: preview
            .filter((r) => r[0] && r[0] !== "-")
            .map((r) => ({
              name: r[0] === "-" ? "" : r[0],
              localized_name: r[1] === "-" ? "" : r[1],
              city: r[2] === "-" ? "" : r[2],
            })),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Import failed");

      toast.showSuccess(`Imported ${data.count || 0} retailer(s)`);
      closeImportModal();
      loadRetailers({ targetPage: 1, search: searchQuery, limit: pageSize });
      setPage(1);
    } catch (err) {
      toast.showError(err.message || "Import failed");
    } finally {
      setImporting(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget?.id) return;
    setDeleting(true);
    try {
      const response = await fetch(`/app/retailers/${deleteTarget.id}`, {
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
      toast.showSuccess("Retailer deleted");
      setDeleteTarget(null);
      loadRetailers({ targetPage: page, search: searchQuery, limit: pageSize });
    } catch (err) {
      toast.showError(err.message || "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  async function updateRetailer() {
    try {
      const response = await fetch(`/app/retailers/${editRetailer.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: editRetailer.retailer_name,
          localized_name: editRetailer.retailer_name_localized,
          city: editRetailer.retailer_city,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Update failed");

      setEditOpen(false);
      toast.showSuccess("Retailer updated");
      loadRetailers({ targetPage: page, search: searchQuery, limit: pageSize });
    } catch (err) {
      toast.showError(err.message || "Update failed");
    }
  }

  async function handleRequiredToggle(value) {
    setRetailerRequired(value);
    await fetch("/app/settings/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ retailer_required: value ? 1 : 0 }),
    });
  }

  const tableRows = rows.map((r) => [
    displayCell(r.retailer_name),
    displayCell(r.retailer_name_localized),
    displayCell(r.retailer_city),
    <div className="wa-table-actions" key={`actions-${r.id}`}>
      <Button
        size="slim"
        onClick={() => {
          setEditRetailer({
            id: r.id,
            retailer_name: r.retailer_name || "",
            retailer_name_localized: r.retailer_name_localized || "",
            retailer_city: r.retailer_city || "",
          });
          setEditOpen(true);
        }}
      >
        Edit
      </Button>
      <Button
        size="slim"
        tone="critical"
        onClick={() => setDeleteTarget(r)}
      >
        Delete
      </Button>
    </div>,
  ]);

  return (
    <Page
      title="Retailers"
      primaryAction={{
        content: "Import",
        onAction: openImportModal,
      }}
    >
      <Tabs
        tabs={[
          { id: "retailers", content: "Retailers" },
          { id: "settings", content: "Settings" },
        ]}
        selected={selectedTab}
        onSelect={setSelectedTab}
      />

      {selectedTab === 0 && (
        <LegacyCard sectioned>
          <div className="wa-stack-12">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                runSearch();
              }}
              className="wa-compact-form-row"
            >
              <div className="wa-compact-form-row__field">
                <TextField
                  label="Search retailers"
                  labelHidden
                  placeholder="Search by name or city"
                  value={searchInput}
                  onChange={setSearchInput}
                  clearButton
                  onClearButtonClick={clearSearch}
                  autoComplete="off"
                  connectedRight={<Button onClick={runSearch}>Search</Button>}
                />
              </div>
            </form>

            <Link removeUnderline onClick={downloadSample}>
              Download sample Excel
            </Link>

            {loading ? (
              <LoadingPanel label="Loading retailers..." />
            ) : rows.length === 0 ? (
              <EmptyState
                heading="No retailers found"
                image=""
                action={{
                  content: "Import retailers",
                  onAction: openImportModal,
                }}
              >
                <p>Import retailers or adjust your search filters.</p>
              </EmptyState>
            ) : (
              <div className="wa-table-scroll">
                <DataTable
                  columnContentTypes={["text", "text", "text", "text"]}
                  headings={["Retailer name", "Localized name", "City", "Actions"]}
                  rows={tableRows}
                />
              </div>
            )}

            {showPagination ? (
              <div className="wa-pagination-bar">
                <Text as="p" tone="subdued">
                  {paginationMeta.total} retailer
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
            <Text variant="headingMd">Warranty Form Settings</Text>
            <Checkbox
              label="Make Retailer field mandatory on warranty registration form"
              checked={retailerRequired}
              onChange={handleRequiredToggle}
            />
            <Text as="p" tone="subdued">
              This setting applies store-wide and affects the customer warranty
              registration form.
            </Text>
          </div>
        </LegacyCard>
      )}

      <Modal
        open={openImport}
        onClose={closeImportModal}
        title="Import retailers"
        primaryAction={{
          content: "Upload and save",
          onAction: saveRetailers,
          disabled: !preview.length,
          loading: importing,
        }}
        secondaryActions={[{ content: "Cancel", onAction: closeImportModal }]}
      >
        <Modal.Section>
          <div className="wa-stack-12">
            <Banner tone="info">
              Empty fields are shown as "-" in the preview and stored as blank values.
            </Banner>
            <DropZone accept=".csv,.xlsx" onDrop={handleDrop}>
              <DropZone.FileUpload />
            </DropZone>
            <Link removeUnderline onClick={downloadSample}>
              Download sample Excel
            </Link>
            {preview.length > 0 ? (
              <div className="wa-table-scroll">
                <DataTable
                  columnContentTypes={["text", "text", "text"]}
                  headings={["Retailer name", "Localized name", "City"]}
                  rows={preview}
                />
              </div>
            ) : null}
          </div>
        </Modal.Section>
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete retailer"
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
            <strong>{displayCell(deleteTarget?.retailer_name)}</strong>
            ? This action cannot be undone.
          </Text>
        </Modal.Section>
      </Modal>

      {editRetailer ? (
        <Modal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          title="Edit retailer"
          primaryAction={{ content: "Save", onAction: updateRetailer }}
        >
          <Modal.Section>
            <div className="wa-stack-12">
              <TextField
                label="Retailer name"
                value={editRetailer.retailer_name}
                onChange={(v) =>
                  setEditRetailer({ ...editRetailer, retailer_name: v })
                }
              />
              <TextField
                label="Localized name"
                value={editRetailer.retailer_name_localized || ""}
                onChange={(v) =>
                  setEditRetailer({
                    ...editRetailer,
                    retailer_name_localized: v,
                  })
                }
                helpText="Optional translated or alternate name for this store's language."
              />
              <TextField
                label="City"
                value={editRetailer.retailer_city || ""}
                onChange={(v) =>
                  setEditRetailer({ ...editRetailer, retailer_city: v })
                }
              />
            </div>
          </Modal.Section>
        </Modal>
      ) : null}
    </Page>
  );
}
