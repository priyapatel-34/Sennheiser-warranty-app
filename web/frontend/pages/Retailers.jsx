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
    LegacyStack,
    Link,
    Pagination,
  } from "@shopify/polaris";
  import { useEffect, useState } from "react";
  import * as XLSX from "xlsx";

  const PAGE_SIZE = 25;
  
  export default function Retailers() {
    const [selectedTab, setSelectedTab] = useState(0);
  
    const [rows, setRows] = useState([]);
    const [searchInput, setSearchInput] = useState("");
    const [searchQuery, setSearchQuery] = useState("");
    const [page, setPage] = useState(1);
    const [paginationMeta, setPaginationMeta] = useState({
      total: 0,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    });
    const [loading, setLoading] = useState(false);
    const [openImport, setOpenImport] = useState(false);
    const [preview, setPreview] = useState([]);
  
    const [editRetailer, setEditRetailer] = useState(null);
    const [editOpen, setEditOpen] = useState(false);
  
    const [retailerRequired, setRetailerRequired] = useState(false);
  
    async function loadRetailers({
      targetPage = page,
      search = searchQuery,
    } = {}) {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(targetPage),
          limit: String(PAGE_SIZE),
        });
        if (search) params.set("q", search);

        const response = await fetch(`/app/retailers/?${params.toString()}`, {
          method: "GET",
          credentials: "include",
          headers: {
            Accept: "application/json",
          },
        });
      
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
  
        const contentType = response.headers.get("content-type");
  
        if (!contentType || !contentType.includes("application/json")) {
          const text = await response.text();
          console.error("Non-JSON response:", text);
          throw new Error("Expected JSON, got HTML");
        }
  
        const data = await response.json();
        const retailerRows = Array.isArray(data)
          ? data
          : Array.isArray(data.retailers)
            ? data.retailers
            : [];
        setRows(retailerRows);

        const meta = data.pagination || {};
        setPaginationMeta({
          total: meta.total || retailerRows.length,
          totalPages: meta.totalPages || 1,
          hasNextPage: Boolean(meta.hasNextPage),
          hasPreviousPage: Boolean(meta.hasPreviousPage),
        });
        if (meta.page) setPage(meta.page);
      } catch (err) {
        console.error("Failed to load retailers:", err);
        setRows([]);
      } finally {
        setLoading(false);
      }
    }
  
    async function loadSettings() {
      const r = await fetch("/app/settings/requiredRetailer", { credentials: "include" });
      const data = await r.json();
      console.log("Retailer is required::", data.retailer_required);
      setRetailerRequired(Boolean(data.retailer_required));
    }
  
    useEffect(() => {
      loadSettings();
    }, []);

    useEffect(() => {
      if (selectedTab === 0) {
        loadRetailers({ targetPage: page, search: searchQuery });
      }
    }, [selectedTab, page, searchQuery]);

    const runSearch = () => {
      setPage(1);
      setSearchQuery(searchInput.trim());
    };

    const clearSearch = () => {
      setSearchInput("");
      setSearchQuery("");
      setPage(1);
    };

    const showPagination = !loading && paginationMeta.totalPages > 1;
  
    /* ---------------- SAMPLE EXCEL ---------------- */
    function downloadSample() {
      const ws = XLSX.utils.json_to_sheet([
        {
          "Retailer Name": "Amazon",
          "City": "Mumbai",
          "Retailer JA": "アマゾン",
        },
      ]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Retailers");
      XLSX.writeFile(wb, "retailers-sample.xlsx");
    }
  
    /* ---------------- IMPORT ---------------- */
    function handleDrop(files) {
      const reader = new FileReader();
      reader.onload = e => {
        const wb = XLSX.read(e.target.result, { type: "binary" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(sheet);
  
        setPreview(
          data.map(r => [
            r["Retailer Name"],
            r["City"],
            r["Retailer JA"],
          ])
        );
      };
      reader.readAsBinaryString(files[0]);
    }
  
    async function saveRetailers() {
      await fetch("/app/retailers/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          retailers: preview.map(r => ({
            name: r[0],
            city: r[1],
            name_ja: r[2],
          })),
        }),
      });
  
      setPreview([]);
      setOpenImport(false);
      loadRetailers();
    }
  
    /* ---------------- CRUD ---------------- */
    async function deleteRetailer(id) {
      await fetch(`/app/retailers/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      loadRetailers();
    }
  
    async function updateRetailer() {
      await fetch(`/app/retailers/${editRetailer.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(editRetailer),
      });
  
      setEditOpen(false);
      loadRetailers();
    }
  
    /* ---------------- SETTINGS ---------------- */
    async function handleRequiredToggle(value) {
      setRetailerRequired(value);
  
      const r = await fetch("/app/settings/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          retailer_required: value ? 1 : 0,
        }),
      });

      console.log("response :: ", r.json());
    }
  
    /* ---------------- TABLE ---------------- */
    const tableRows = rows.map(r => [
      r.retailer_name,
      r.retailer_city,
      // <LegacyStack gap="200">
      //   <Button size="slim" onClick={() => {
      //     setEditRetailer(r);
      //     setEditOpen(true);
      //   }}>
      //     Edit
      //   </Button>
      //   <Button size="slim" destructive onClick={() => deleteRetailer(r.id)}>
      //     Delete
      //   </Button>
      // </LegacyStack>,
    ]);



    // const rowMarkup = rows.map((r, index) => (
    //     <IndexTable.Row
    //       id={r.id}
    //       key={r.id}
    //       selected={selectedResources.includes(r.id)}
    //       position={index}
    //     >
    //       <IndexTable.Cell>
    //         <Text as="span" fontWeight="medium">
    //           {r.retailer_name}
    //         </Text>
    //       </IndexTable.Cell>
      
    //       <IndexTable.Cell>{r.retailer_code}</IndexTable.Cell>
      
    //       <IndexTable.Cell>
    //         <Text tone={r.retailer_type === "offline" ? "critical" : "success"}>
    //           {r.retailer_type}
    //         </Text>
    //       </IndexTable.Cell>
      
    //       <IndexTable.Cell>{r.retailer_city}</IndexTable.Cell>
      
    //       <IndexTable.Cell>
    //         <InlineStack gap="200">
    //           <Button
    //             size="slim"
    //             onClick={() => {
    //               setEditRetailer(r);
    //               setEditOpen(true);
    //             }}
    //           >
    //             Edit
    //           </Button>
      
    //           <Button
    //             size="slim"
    //             destructive
    //             onClick={() => deleteRetailer(r.id)}
    //           >
    //             Delete
    //           </Button>
    //         </InlineStack>
    //       </IndexTable.Cell>
    //     </IndexTable.Row>
    //   ));
      

  
    return (
      <Page
        title="Retailers"
        primaryAction={{
          content: "Import",
          onAction: () => setOpenImport(true),
        }}
      >
        {/* ---------------- TABS ---------------- */}
        <Tabs
          tabs={[
            { id: "retailers", content: "Retailers" },
            { id: "settings", content: "Settings" },
          ]}
          selected={selectedTab}
          onSelect={setSelectedTab}
        />
  
        {/* ---------------- TAB 1: RETAILERS ---------------- */}
        {selectedTab === 0 && (
          <LegacyCard sectioned>
            <LegacyStack vertical gap="400">
              <form
                onSubmit={e => {
                  e.preventDefault();
                  runSearch();
                }}
              >
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
              </form>

              <Link removeUnderline onClick={downloadSample}>
                Download sample Excel
              </Link>
  
              <DataTable
                columnContentTypes={["text", "text", "text"]}
                headings={["Retailer EN", "Retailer JA", "City"]}
                rows={rows}
              />

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 12,
                }}
              >
                <Text as="p" tone="subdued">
                  {paginationMeta.total} retailer
                  {paginationMeta.total === 1 ? "" : "s"}
                  {searchQuery ? ` matching "${searchQuery}"` : ""}
                  {showPagination
                    ? ` · Page ${page} of ${paginationMeta.totalPages}`
                    : ""}
                </Text>
                {showPagination ? (
                  <div gap="200" blockAlign="center">
                    <Button disabled={page <= 1} onClick={() => setPage(1)}>
                      First
                    </Button>
                    <Pagination
                      hasPrevious={paginationMeta.hasPreviousPage}
                      onPrevious={() => setPage(p => Math.max(1, p - 1))}
                      hasNext={paginationMeta.hasNextPage}
                      onNext={() => setPage(p => p + 1)}
                      label={`Page ${page} of ${paginationMeta.totalPages}`}
                    />
                    <Button
                      disabled={page >= paginationMeta.totalPages}
                      onClick={() => setPage(paginationMeta.totalPages)}
                    >
                      Last
                    </Button>
                  </div>
                ) : null}
              </div>
            </LegacyStack>
          </LegacyCard>
        )}
  
        {/* ---------------- TAB 2: SETTINGS ---------------- */}
        {selectedTab === 1 && (
          <LegacyCard sectioned>
            <LegacyStack vertical gap="300">
              <Text variant="headingMd">Warranty Form Settings</Text>
  
              <Checkbox
                label="Make Retailer field mandatory on warranty registration form"
                checked={retailerRequired}
                onChange={handleRequiredToggle}
              />
  
              <Text as="p" color="subdued">
                This setting applies store-wide and affects the customer warranty
                registration form.
              </Text>
            </LegacyStack>
          </LegacyCard>
        )}
  
        {/* ---------------- IMPORT MODAL ---------------- */}
        <Modal
          open={openImport}
          onClose={() => setOpenImport(false)}
          title="Import retailers"
          primaryAction={{
            content: "Upload and save",
            onAction: saveRetailers,
            disabled: !preview.length,
          }}
          secondaryActions={[
            { content: "Cancel", onAction: () => setOpenImport(false) },
          ]}
        >
          <Modal.Section>
            <LegacyStack vertical gap="300">
              <DropZone accept=".csv,.xlsx" onDrop={handleDrop}>
                <DropZone.FileUpload />
              </DropZone>
  
              <Link removeUnderline onClick={downloadSample}>
                Download sample Excel
              </Link>
  
              {preview.length > 0 && (
                <DataTable
                  columnContentTypes={["text", "text", "text"]}
                  headings={[
                    "Retailer",
                    "City",
                    "Retailer JA"
                  ]}
                  rows={preview}
                />
              )}
            </LegacyStack>
          </Modal.Section>
        </Modal>
  
        {/* ---------------- EDIT MODAL ---------------- */}
        {editRetailer && (
          <Modal
            open={editOpen}
            onClose={() => setEditOpen(false)}
            title="Edit retailer"
            primaryAction={{ content: "Save", onAction: updateRetailer }}
          >
            <Modal.Section>
              <LegacyStack vertical gap="300">
                <TextField
                  label="Retailer name"
                  value={editRetailer.name}
                  onChange={v => setEditRetailer({ ...editRetailer, name: v })}
                />
                <TextField
                  label="City"
                  value={editRetailer.city}
                  onChange={v => setEditRetailer({ ...editRetailer, city: v })}
                />
              </LegacyStack>
            </Modal.Section>
          </Modal>
        )}
      </Page>
    );
  }
  