import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const buildDir = path.dirname(fileURLToPath(import.meta.url));
const mcpDir = path.dirname(buildDir);
const pluginDir = path.dirname(mcpDir);
const npmCommand = process.env.npm_execpath ? process.execPath : "npm";
const npmArgs = [
  ...(process.env.npm_execpath ? [process.env.npm_execpath] : []),
  "ls",
  "--omit=dev",
  "--all",
  "--parseable"
];
const installedPaths = execFileSync(
  npmCommand,
  npmArgs,
  { cwd: pluginDir, encoding: "utf8", windowsHide: true }
)
  .split(/\r?\n/u)
  .map((value) => value.trim())
  .filter((value) => value && path.resolve(value) !== path.resolve(pluginDir));

const packages = new Map();
for (const installedPath of installedPaths) {
  const manifestPath = path.join(installedPath, "package.json");
  if (!fs.existsSync(manifestPath)) continue;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const key = `${manifest.name}@${manifest.version}`;
  if (packages.has(key)) continue;
  const licenseName = fs.readdirSync(installedPath).find((name) => /^(?:licen[cs]e|copying|notice)(?:\..*)?$/iu.test(name));
  packages.set(key, {
    name: manifest.name,
    version: manifest.version,
    declaredLicense: manifest.license || "not declared",
    homepage: typeof manifest.homepage === "string" ? manifest.homepage : "",
    licenseText: licenseName
      ? fs.readFileSync(path.join(installedPath, licenseName), "utf8").trim().replace(/[ \t]+$/gmu, "")
      : "No standalone license file was present in the installed package. See its package metadata and upstream repository."
  });
}

const sections = [...packages.values()]
  .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
  .map((entry) => [
    `===== ${entry.name}@${entry.version} =====`,
    `Declared license: ${entry.declaredLicense}`,
    ...(entry.homepage ? [`Upstream: ${entry.homepage}`] : []),
    "",
    entry.licenseText
  ].join("\n"));

const header = [
  "THIRD-PARTY LICENSES FOR THE BUNDLED MCP SERVER",
  "",
  "Generated from the locked production dependency tree. Package authors retain all rights described below.",
  ""
].join("\n");
const outputPath = path.join(mcpDir, "dist", "THIRD_PARTY_LICENSES.txt");
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${header}${sections.join("\n\n")}\n`, "utf8");
console.log(`Wrote ${packages.size} third-party license entries.`);
