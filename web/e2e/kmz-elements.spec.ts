import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";
import { zip } from "./xlsx";

// A KMZ with folders of areas and points near DEV Kuala Lumpur DC and no route line, so applying it for real
// changes no segment line. The cluster name is new on every run.
const stamp = Date.now();
const CLUSTER = `E2E Cluster ${stamp}`;
// Stamped too: a folder named like an existing cluster defaults to it, and an earlier run may have made one.
const AREA = `Cluster area ${stamp}`;

function box(lon: number, lat: number, half: number) {
  const corners = [[lon - half, lat - half], [lon + half, lat - half], [lon + half, lat + half],
    [lon - half, lat + half], [lon - half, lat - half]];
  const text = corners.map(([x, y]) => `${x},${y},0`).join(" ");
  return `<Polygon><outerBoundaryIs><LinearRing><coordinates>${text}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
}

function kmz() {
  const area = `<Placemark><name>Boundary</name>${box(101.6875, 3.1395, 0.004)}</Placemark>`;
  const blocks = `<Placemark><name>Blocks</name><MultiGeometry>${box(101.68, 3.13, 0.0005)}${box(101.682, 3.13, 0.0005)}`
    + "</MultiGeometry></Placemark>";
  const poe = "<Placemark><name>POE 1</name><Point><coordinates>101.687,3.141,0</coordinates></Point></Placemark>";
  const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Folder><name>E2E Cluster</name>
<Folder><name>${AREA}</name>${area}</Folder>
<Folder><name>Blocks</name>${blocks}</Folder>
<Folder><name>POE</name>${poe}</Folder>
</Folder></Document></kml>`;
  return { name: `e2e-elements-${stamp}.kmz`, mimeType: "application/vnd.google-earth.kmz", buffer: zip([["doc.kml", kml]]) };
}

test("KMZ folders: tree counts, preview targets, apply saves folders and a new cluster", async ({ page }) => {
  await signIn(page, "admin1");
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Upload" }).click();
  await page.getByRole("tab", { name: "KMZ" }).click();
  await page.getByLabel("Upload a KMZ file").setInputFiles(kmz());
  const tree = page.getByRole("group", { name: "Folders" });
  await expect(tree).toContainText("3 areas · 1 point");
  await tree.getByRole("button", { name: "Select all" }).click();
  await page.getByRole("button", { name: "Preview", exact: true }).click();

  const preview = page.getByTestId("kmz-preview");
  const folders = preview.getByRole("table", { name: "Folders" });
  await expect(folders.getByRole("row")).toHaveCount(4);
  await expect(folders).toContainText("Needs review: pick a target");
  await expect(preview.getByRole("button", { name: /^Apply/ })).toBeDisabled();

  await page.getByLabel("Target for Blocks").selectOption("segment");
  await expect(preview.getByRole("button", { name: "Apply 1 folder" })).toBeDisabled();
  await page.getByLabel("Segment for Blocks").fill("DEV Kuala Lumpur DC - DEV Cyberjaya DC");
  await page.getByLabel(`Target for ${AREA}`).selectOption("cluster");
  await page.getByLabel(`Cluster for ${AREA}`).fill(CLUSTER);
  await expect(preview.getByRole("group", { name: "Sites in the new cluster" })
    .getByRole("checkbox", { name: "DEV Kuala Lumpur DC" })).toBeChecked();
  await preview.getByRole("button", { name: "Apply 2 folders" }).click();

  const result = page.getByTestId("kmz-result");
  await expect(result).toContainText("2 folders saved.");
  await expect(result).toContainText("1 cluster created.");
  await result.getByRole("button", { name: "Upload another" }).click();
  await expect(result).toBeEmpty();
});
