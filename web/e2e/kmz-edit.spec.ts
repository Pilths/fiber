import { expect, test, type Page } from "@playwright/test";
import { pickSegment, signIn } from "./helpers";
import { zip } from "./xlsx";

// Edit segment "Map elements" and the Clusters tab. Each run adds a new folder and a new cluster with a fresh name
// and leaves both hidden, so repeated runs on the DEV database do not clutter the map.
const stamp = Date.now();
const FOLDER = `E2E Poles ${stamp}`;
const CLUSTER = `E2E Edit Cluster ${stamp}`;
const AREA_FOLDER = `E2E Area ${stamp}`;
const KLCJ = /^DEV Kuala Lumpur DC - DEV Cyberjaya DC/;

test.use({ viewport: { width: 1440, height: 900 } });

function kmz(folder: string, placemark: string) {
  const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Folder><name>${folder}</name>${placemark}</Folder></Document></kml>`;
  return { name: `e2e-edit-${stamp}.kmz`, mimeType: "application/vnd.google-earth.kmz", buffer: zip([["doc.kml", kml]]) };
}

const POLE = "<Placemark><name>Pole 1</name><Point><coordinates>101.687,3.141,0</coordinates></Point></Placemark>";
const AREA = "<Placemark><name>Area</name><Polygon><outerBoundaryIs><LinearRing><coordinates>"
  + "101.68,3.13,0 101.681,3.13,0 101.681,3.131,0 101.68,3.131,0 101.68,3.13,0"
  + "</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>";

// A new cluster made the way the KMZ upload makes one: folders -> preview -> apply with a new cluster name.
async function createCluster(page: Page) {
  const file = kmz(AREA_FOLDER, AREA);
  const folders = await (await page.request.post("/api/admin/kmz/folders", { multipart: { file } })).json();
  const staged = await page.request.post("/api/admin/kmz/uploads", {
    multipart: { file, folder_ids: folders.folders[0].id },
  });
  expect(staged.ok()).toBeTruthy();
  const preview = await staged.json();
  const group = { key: preview.groups[0].key, target: "cluster", new_cluster_name: CLUSTER, member_site_ids: [] };
  const applied = await page.request.post(`/api/admin/kmz/uploads/${preview.upload_id}/apply`, {
    data: { route_segment_ids: [], groups: [group] },
  });
  expect(applied.ok()).toBeTruthy();
}

test("Edit segment: add a folder from KMZ, hide and show it", async ({ page }) => {
  await signIn(page, "admin1");
  await pickSegment(page, KLCJ);
  await page.getByTestId("segment-actions").getByRole("button", { name: "Edit segment" }).click();
  const dialog = page.getByRole("dialog", { name: /^Edit segment/ });

  await dialog.getByRole("button", { name: "Add from KMZ" }).click();
  const add = page.getByRole("dialog", { name: /^Add from KMZ to / });
  await add.getByLabel("Upload a KMZ file").setInputFiles(kmz(FOLDER, POLE));
  await add.getByRole("group", { name: "Folders" }).getByRole("button", { name: "Select all" }).click();
  await add.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(add.getByLabel(`Target for ${FOLDER}`)).toHaveCount(0);
  await add.getByRole("button", { name: "Apply 1 folder" }).click();
  await expect(add.getByTestId("kmz-result")).toContainText("1 folder saved.");
  await add.getByRole("button", { name: "Close", exact: true }).click();

  const row = dialog.getByTestId(`map-group-${FOLDER}`);
  await expect(row).toContainText("1 point");
  await expect(row).not.toContainText("Hidden");
  await row.getByRole("button", { name: `Hide ${FOLDER}` }).click();
  await expect(row).toContainText("Hidden");
  await row.getByRole("button", { name: `Show ${FOLDER}` }).click();
  await expect(row).not.toContainText("Hidden");
  await row.getByRole("button", { name: `Hide ${FOLDER}` }).click();
  await expect(row).toContainText("Hidden");
});

test("Clusters: add and remove a site, hide the area", async ({ page }) => {
  await signIn(page, "admin1");
  await createCluster(page);
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Upload" }).click();
  await page.getByRole("tab", { name: "Clusters" }).click();

  const row = page.getByTestId(`cluster-${CLUSTER}`);
  await expect(row).toContainText("0 sites");
  await row.getByRole("button", { name: `Sites of ${CLUSTER}` }).click();
  const picker = page.getByLabel("Add site");
  await picker.fill("DEV Cyberjaya D");
  await expect(page.locator('datalist option[value="DEV Cyberjaya DC"]')).toBeAttached();
  await picker.fill("DEV Cyberjaya DC");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const members = page.getByRole("list", { name: `Sites in ${CLUSTER}` });
  await expect(members).toContainText("DEV Cyberjaya DC");
  await expect(row).toContainText("1 site");

  await members.getByRole("button", { name: "Remove DEV Cyberjaya DC" }).click();
  await expect(members).toHaveCount(0);
  await expect(row).toContainText("0 sites");

  await row.getByRole("button", { name: `Hide ${AREA_FOLDER}` }).click();
  await expect(row).toContainText("Hidden");
});
