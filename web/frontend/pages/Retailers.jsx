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

const EMPTY_ADD_FORM = { name: "", localized_name: "", country: "" };
const EMPTY_ADD_ERRORS = { name: "", country: "" };

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

  // Import modal state
  const [openImport, setOpenImport] = useState(false);
  const [preview, setPreview] = useState([]);
  const [importing, setImporting] = useState(false);

  // Add retailer modal state
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_ADD_FORM);
  const [addErrors, setAddErrors] = useState(EMPTY_ADD_ERRORS);
  const [adding, setAdding] = useState(false);

  // Edit modal state
  const [editRetailer, setEditRetailer] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editErrors, setEditErrors] = useState(EMPTY_ADD_ERRORS);

  // Delete modal state
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

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

  const resetImportState = () => setPreview([]);

  const openImportModal = () => {
    resetImportState();
    setOpenImport(true);
  };

  const closeImportModal = () => {
    setOpenImport(false);
    resetImportState();
  };

  function downloadSample() {
    const ws = XLSX.utils.json_to_sheet([
      {
        "Retailer Name": "Amazon",
        Country: "Japan",
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
          displayCell(r.Country),
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
              country: r[2] === "-" ? "" : r[2],
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

  // ── Manual Add ──────────────────────────────────────────────────────────────

  const openAddModal = () => {
    setAddForm(EMPTY_ADD_FORM);
    setAddErrors(EMPTY_ADD_ERRORS);
    setAddOpen(true);
  };

  const closeAddModal = () => {
    setAddOpen(false);
    setAddErrors(EMPTY_ADD_ERRORS);
  };

  function validateAddForm() {
    const errors = { name: "", country: "" };
    if (!addForm.name.trim()) errors.name = "Retailer name is required";
    if (!addForm.country.trim()) errors.country = "Country is required";
    setAddErrors(errors);
    return !errors.name && !errors.country;
  }

  async function saveNewRetailer() {
    if (!validateAddForm()) return;
    setAdding(true);
    try {
      const response = await fetch("/app/retailers/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          retailers: [
            {
              name: addForm.name.trim(),
              country: addForm.country.trim(),
              localized_name: addForm.localized_name.trim(),
            },
          ],
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to add retailer");

      toast.showSuccess("Retailer added");
      closeAddModal();
      loadRetailers({ targetPage: 1, search: searchQuery, limit: pageSize });
      setPage(1);
    } catch (err) {
      toast.showError(err.message || "Failed to add retailer");
    } finally {
      setAdding(false);
    }
  }

  // ── Search ──────────────────────────────────────────────────────────────────

  const runSearch = () => {
    setPage(1);
    setSearchQuery(searchInput.trim());
  };

  const clearSearch = () => {
    setSearchInput("");
    setSearchQuery("");
    setPage(1);
  };

  // ── Delete ──────────────────────────────────────────────────────────────────

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

  // ── Edit ────────────────────────────────────────────────────────────────────

  function validateEditForm() {
    const errors = { name: "", country: "" };
    if (!editRetailer?.retailer_name?.trim()) errors.name = "Retailer name is required";
    if (!editRetailer?.retailer_country?.trim()) errors.country = "Country is required";
    setEditErrors(errors);
    return !errors.name && !errors.country;
  }

  async function updateRetailer() {
    if (!validateEditForm()) return;
    try {
      const response = await fetch(`/app/retailers/${editRetailer.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: editRetailer.retailer_name,
          localized_name: editRetailer.retailer_name_localized,
          country: editRetailer.retailer_country,
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

  // ── Settings ─────────────────────────────────────────────────────────────────

  async function handleRequiredToggle(value) {
    setRetailerRequired(value);
    await fetch("/app/settings/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ retailer_required: value ? 1 : 0 }),
    });
  }

  // ── Table rows ───────────────────────────────────────────────────────────────

  const tableRows = rows.map((r) => [
    displayCell(r.retailer_name),
    displayCell(r.retailer_name_localized),
    displayCell(r.retailer_country),
    <div className="wa-table-actions" key={`actions-${r.id}`}>
      <Button
        size="slim"
        onClick={() => {
          setEditRetailer({
            id: r.id,
            retailer_name: r.retailer_name || "",
            retailer_name_localized: r.retailer_name_localized || "",
            retailer_country: r.retailer_country || "",
          });
          setEditErrors(EMPTY_ADD_ERRORS);
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

  const showPagination = !loading && paginationMeta.total > 0;

  return (
    <Page
      title="Retailers"
      primaryAction={{
        content: "Add retailer",
        onAction: openAddModal,
      }}
      secondaryActions={[
        { content: "Import", onAction: openImportModal },
      ]}
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
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 260px", minWidth: 220 }}>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    runSearch();
                  }}
                >
                  <TextField
                    label="Search retailers"
                    labelHidden
                    placeholder="Search by name, country or city"
                    value={searchInput}
                    onChange={setSearchInput}
                    clearButton
                    onClearButtonClick={clearSearch}
                    autoComplete="off"
                    connectedRight={
                      <Button onClick={runSearch}>Search</Button>
                    }
                  />
                </form>
              </div>
              <Button onClick={downloadSample}>Download sample</Button>
            </div>

            {loading ? (
              <LoadingPanel label="Loading retailers..." />
            ) : rows.length === 0 ? (
              <EmptyState
                heading="No retailers found"
                image=""
                action={{
                  content: "Add retailer",
                  onAction: openAddModal,
                }}
                secondaryAction={{
                  content: "Import retailers",
                  onAction: openImportModal,
                }}
              >
                <p>
                  {searchQuery
                    ? "Try adjusting your search or add a new retailer."
                    : "Add a retailer manually or import a list from Excel."}
                </p>
              </EmptyState>
            ) : (
              <div className="wa-table-scroll">
                <DataTable
                  columnContentTypes={["text", "text", "text", "text"]}
                  headings={["Retailer name", "Localized name", "Country", "Actions"]}
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

      {/* ── Add Retailer Modal ── */}
      <Modal
        open={addOpen}
        onClose={closeAddModal}
        title="Add retailer"
        primaryAction={{
          content: "Save",
          onAction: saveNewRetailer,
          loading: adding,
        }}
        secondaryActions={[{ content: "Cancel", onAction: closeAddModal }]}
      >
        <Modal.Section>
          <div className="wa-stack-12">
            <TextField
              label="Retailer name"
              value={addForm.name}
              onChange={(v) => {
                setAddForm((p) => ({ ...p, name: v }));
                if (addErrors.name) setAddErrors((p) => ({ ...p, name: "" }));
              }}
              autoComplete="off"
              error={addErrors.name}
              requiredIndicator
            />
            <TextField
              label="Country"
              value={addForm.country}
              onChange={(v) => {
                setAddForm((p) => ({ ...p, country: v }));
                if (addErrors.country) setAddErrors((p) => ({ ...p, country: "" }));
              }}
              autoComplete="off"
              error={addErrors.country}
              requiredIndicator
            />
            <TextField
              label="Localized name"
              value={addForm.localized_name}
              onChange={(v) => setAddForm((p) => ({ ...p, localized_name: v }))}
              autoComplete="off"
              helpText="Optional translated or alternate name for this store's language."
            />
          </div>
        </Modal.Section>
      </Modal>

      {/* ── Import Modal ── */}
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
              Required columns: <strong>Retailer Name</strong>, <strong>Country</strong>.
              Optional: Localized Name. Empty fields are stored as blank values.
            </Banner>
            <DropZone accept=".csv,.xlsx" onDrop={handleDrop}>
              <DropZone.FileUpload />
            </DropZone>
            <Button plain onClick={downloadSample}>
              Download sample Excel
            </Button>
            {preview.length > 0 ? (
              <div className="wa-table-scroll">
                <DataTable
                  columnContentTypes={["text", "text", "text"]}
                  headings={["Retailer name", "Localized name", "Country"]}
                  rows={preview}
                />
              </div>
            ) : null}
          </div>
        </Modal.Section>
      </Modal>

      {/* ── Delete Confirmation Modal ── */}
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

      {/* ── Edit Modal ── */}
      {editRetailer ? (
        <Modal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          title="Edit retailer"
          primaryAction={{ content: "Save", onAction: updateRetailer }}
          secondaryActions={[{ content: "Cancel", onAction: () => setEditOpen(false) }]}
        >
          <Modal.Section>
            <div className="wa-stack-12">
              <TextField
                label="Retailer name"
                value={editRetailer.retailer_name}
                onChange={(v) => {
                  setEditRetailer({ ...editRetailer, retailer_name: v });
                  if (editErrors.name) setEditErrors((p) => ({ ...p, name: "" }));
                }}
                error={editErrors.name}
                requiredIndicator
                autoComplete="off"
              />
              <TextField
                label="Country"
                value={editRetailer.retailer_country || ""}
                onChange={(v) => {
                  setEditRetailer({ ...editRetailer, retailer_country: v });
                  if (editErrors.country) setEditErrors((p) => ({ ...p, country: "" }));
                }}
                error={editErrors.country}
                requiredIndicator
                autoComplete="off"
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
                autoComplete="off"
              />
            </div>
          </Modal.Section>
        </Modal>
      ) : null}
    </Page>
  );
}
