import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseVersion(version) {
  const match = VERSION_PATTERN.exec(version);
  if (!match) {
    throw new Error(`Invalid stable semantic version: ${version}`);
  }

  return match.slice(1).map(Number);
}

export function nextPatchVersion(tags, currentVersion) {
  const versions = tags
    .filter((tag) => tag.startsWith("v"))
    .map((tag) => tag.slice(1))
    .filter((version) => VERSION_PATTERN.test(version));

  versions.push(currentVersion);
  versions.sort((left, right) => {
    const leftParts = parseVersion(left);
    const rightParts = parseVersion(right);

    for (let index = 0; index < leftParts.length; index += 1) {
      if (leftParts[index] !== rightParts[index]) {
        return rightParts[index] - leftParts[index];
      }
    }

    return 0;
  });

  const [major, minor, patch] = parseVersion(versions[0]);
  return `${major}.${minor}.${patch + 1}`;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function extractCargoVersion(contents, path) {
  const match = /^\[package\][\s\S]*?^version = "([^"]+)"/m.exec(contents);
  if (!match) {
    throw new Error(`Could not find the package version in ${path}`);
  }

  return match[1];
}

function updateCargoVersion(contents, version, path) {
  const updated = contents.replace(
    /^(\[package\][\s\S]*?^version = ")[^"]+(")/m,
    `$1${version}$2`,
  );

  if (updated === contents) {
    throw new Error(`Could not update the package version in ${path}`);
  }

  return updated;
}

function extractCargoLockVersion(contents, path) {
  const match =
    /^\[\[package\]\]\nname = "kusto-explorer"\nversion = "([^"]+)"/m.exec(
      contents,
    );
  if (!match) {
    throw new Error(`Could not find the application version in ${path}`);
  }

  return match[1];
}

function updateCargoLockVersion(contents, version, path) {
  const updated = contents.replace(
    /^(\[\[package\]\]\nname = "kusto-explorer"\nversion = ")[^"]+(")/m,
    `$1${version}$2`,
  );

  if (updated === contents) {
    throw new Error(`Could not update the application version in ${path}`);
  }

  return updated;
}

function prepareRelease() {
  const packagePath = "package.json";
  const packageLockPath = "package-lock.json";
  const tauriPath = "src-tauri/tauri.conf.json";
  const cargoPath = "src-tauri/Cargo.toml";
  const cargoLockPath = "src-tauri/Cargo.lock";

  const packageJson = readJson(packagePath);
  const packageLock = readJson(packageLockPath);
  const tauriConfig = readJson(tauriPath);
  const cargoContents = readFileSync(cargoPath, "utf8");
  const cargoLockContents = readFileSync(cargoLockPath, "utf8");

  const declaredVersions = new Set([
    packageJson.version,
    packageLock.version,
    packageLock.packages[""].version,
    tauriConfig.version,
    extractCargoVersion(cargoContents, cargoPath),
    extractCargoLockVersion(cargoLockContents, cargoLockPath),
  ]);

  if (declaredVersions.size !== 1) {
    throw new Error(
      `Version declarations do not match: ${[...declaredVersions].join(", ")}`,
    );
  }

  const currentVersion = packageJson.version;
  parseVersion(currentVersion);

  const tags = execFileSync("git", ["tag", "--list"], {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
  const version = nextPatchVersion(tags, currentVersion);

  packageJson.version = version;
  packageLock.version = version;
  packageLock.packages[""].version = version;
  tauriConfig.version = version;

  writeJson(packagePath, packageJson);
  writeJson(packageLockPath, packageLock);
  writeJson(tauriPath, tauriConfig);
  writeFileSync(
    cargoPath,
    updateCargoVersion(cargoContents, version, cargoPath),
  );
  writeFileSync(
    cargoLockPath,
    updateCargoLockVersion(cargoLockContents, version, cargoLockPath),
  );

  process.stdout.write(version);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  prepareRelease();
}
