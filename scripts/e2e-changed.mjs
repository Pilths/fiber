// Run only the e2e specs related to files changed vs a base (default HEAD, so uncommitted + staged).
// Usage: node scripts/e2e-changed.mjs [--base main] [--list]   (run from the repo root, on the host)
import { execSync, spawnSync } from "node:child_process";

const ALL = "ALL";

// First matching rule wins. A change to a file also runs every spec that depends on it.
const RULES = [
  [/^web\/e2e\/(\w[\w-]*)\.spec\.ts$/, (m) => [`${m[1]}.spec.ts`]],
  [/^web\/e2e\/(helpers|xlsx)\.ts$|^web\/(playwright\.config|package)|^web\/src\/(App|main)\.tsx?$|index\.css$|^web\/src\/(api\/|lib\/status)/, () => ALL],
  [/NetworkDetail/, () => ["network-detail", "loss", "fiber-cut", "admin-edit", "reserve-box", "inventory-layout", "shell"]],
  [/Map|map|basemap|clusterLayout/, () => ["map", "inventory-layout", "route", "customer-mode"]],
  [/RoutePlanner|FindCard/, () => ["route", "network-detail", "map"]],
  [/ReserveBox/, () => ["reserve-box", "route", "network-detail", "approvals"]],
  [/Reservations/, () => ["approvals", "reserve-box", "admin-edit", "customer-mode"]],
  [/CustomerPicker/, () => ["customer-mode", "reserve-box"]],
  [/Upload|upload-parts/, () => ["upload"]],
  [/Auth|Users|AccountMenu/, () => ["auth", "shell"]],
  [/GlobalSearch|Header/, () => ["shell", "map", "customer-mode"]],
  [/AdminEdit|CoreDrawer|AssignDialog|PastePorts|portLabel/, () => ["admin-edit"]],
  [/Measurement|LossCard|lossLevel/, () => ["loss"]],
  [/^api\/app\/ingest\//, () => ["upload"]],
  [/^api\/app\/reservations\//, () => ["reserve-box", "approvals", "route", "admin-edit", "customer-mode"]],
  [/^api\/app\/auth\//, () => ["auth", "shell"]],
  [/^(api\/(app|alembic)\/|docker|compose)/, () => ALL], // unknown backend change: be safe
  [/^web\/src\//, () => ALL], // unknown frontend file: be safe
];

const args = process.argv.slice(2);
const base = args.includes("--base") ? args[args.indexOf("--base") + 1] : "HEAD";
const git = (cmd) => execSync(cmd, { encoding: "utf8" }).split("\n").filter(Boolean);
const changed = [...new Set([...git(`git diff --name-only ${base}`), ...git("git ls-files --others --exclude-standard")])];

const specs = new Set();
for (const file of changed) {
  const rule = RULES.find(([pattern]) => pattern.test(file));
  if (!rule) {
    continue; // docs, scripts etc: no e2e impact
  }
  const result = rule[1](file.match(rule[0]));
  if (result === ALL) {
    specs.clear();
    specs.add(ALL);
    break;
  }
  result.forEach((name) => specs.add(name.replace(/\.spec\.ts$/, "")));
}

if (specs.size === 0) {
  console.log("No e2e-relevant changes.");
  process.exit(0);
}
const files = specs.has(ALL) ? [] : [...specs].map((name) => `e2e/${name}.spec.ts`);
console.log(files.length ? `Running: ${files.join(" ")}` : "Running: all specs");
if (args.includes("--list")) {
  process.exit(0);
}
const run = spawnSync("docker", ["compose", "exec", "-T", "web", "npx", "playwright", "test", ...files], { stdio: "inherit" });
process.exit(run.status ?? 1);
