import {
    Page,
    LegacyCard,
    Button,
    Modal,
    DropZone,
    DataTable,
    IndexTable,
    Text,
    Tabs,
    TextField,
    Checkbox,
    LegacyStack,
    Link,
  } from "@shopify/polaris";
  import { useEffect, useState } from "react";
  import * as XLSX from "xlsx";
  
  export default function Retailers() {
    /* ---------------- STATE ---------------- */
    const [selectedTab, setSelectedTab] = useState(0);
  
    const [rows, setRows] = useState([]);
    const [openImport, setOpenImport] = useState(false);
    const [preview, setPreview] = useState([]);
  
    const [editRetailer, setEditRetailer] = useState(null);
    const [editOpen, setEditOpen] = useState(false);
  
    const [retailerRequired, setRetailerRequired] = useState(false);
  
    /* ---------------- LOAD DATA ---------------- */
    async function loadRetailers() {
        const response = await fetch("/app/retailers/", { 
            method: "GET",
            credentials: "include",
            headers: {
                "Accept": "application/json",
            },
        });
      
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
  
        const contentType = response.headers.get("content-type");
  
      // 🚨 Prevent HTML parsing
      if (!contentType || !contentType.includes("application/json")) {
        const text = await response.text();
        console.error("Non-JSON response:", text);
        throw new Error("Expected JSON, got HTML");
      }
  
      //console.log("Retailers data: ", await response.json());

      const data = await response.json(); // ✅ ONLY ONCE
      console.log("Retailers data: ", data)
      setRows(data);

      //setRows(await response.json());
    }
  
    async function loadSettings() {
      const r = await fetch("/app/settings/requiredRetailer", { credentials: "include" });
      const data = await r.json();
      console.log("Retailer is required::", data.retailer_required);
      setRetailerRequired(Boolean(data.retailer_required));
    }
  
    useEffect(() => {
      loadRetailers();
      loadSettings();
    }, []);
  
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

        // {rows.length === 0 ? (
        //   <LegacyCard sectioned>
        //     <LegacyStack vertical gap="200" align="center">
        //       <Text variant="headingSm" tone="subdued">
        //         No retailers added yet
        //       </Text>

        //       <Text as="p" tone="subdued">
        //         Add retailers to show options in the product registration form.
        //       </Text>

        //       <Button primary onClick={() => setOpenImport(true)}>
        //         Import retailers
        //       </Button>
        //     </LegacyStack>
        //   </LegacyCard>
        // ) : (
          <LegacyCard sectioned>
            <LegacyStack vertical gap="400">
              <Link removeUnderline onClick={downloadSample}>
                Download sample Excel
              </Link>
  
              <DataTable
                columnContentTypes={["text", "text","text"]}
                headings={[
                  "Retailer EN",
                  "Retailer JA",
                  "City"
                ]}
                // rows={tableRows}
                rows={rows}
              />


            {/* <Card padding="0">
                <IndexTable
                    resourceName={{ singular: "retailer", plural: "retailers" }}
                    itemCount={rows.length}
                    selectedItemsCount={
                    allResourcesSelected ? "All" : selectedResources.length
                    }
                    onSelectionChange={handleSelectionChange}
                    headings={[
                    { title: "Retailer" },
                    { title: "Code" },
                    { title: "Type" },
                    { title: "City" },
                    { title: "Actions" },
                    ]}
                    emptyState={
                    <Text alignment="center" tone="subdued">
                        No retailers found
                    </Text>
                    }
                >
                    {rowMarkup}
                </IndexTable>
            </Card> */}

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
  