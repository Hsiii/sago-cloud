import { execFileSync, spawnSync } from "node:child_process";

const service = process.argv[2] ?? "all";
const allowedServices = new Set([
  "all",
  "edge",
  "bot-core",
  "minisago",
  "minisago-worker",
  "obi",
  "proxy",
  "homepage",
  "postgres",
]);
const remoteHost = process.env.PLATFORM_HOST ?? "platform";
const remoteDeployRoot =
  process.env.PLATFORM_OPERATIONS_ROOT ?? "/srv/platform/operations";

const deployTargets = {
  proxy: "edge",
};

function output(command, args) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!allowedServices.has(service)) {
  console.error(`Unknown deploy target: ${service}`);
  process.exit(1);
}

const branch = output("git", ["branch", "--show-current"]);

if (branch !== "main") {
  console.error(
    `Deploy from main. Current branch is ${branch || "(detached)"}.`,
  );
  process.exit(1);
}

if (output("git", ["status", "--porcelain"])) {
  console.error("Commit or stash local changes before deploying.");
  process.exit(1);
}

const commit = output("git", ["rev-parse", "HEAD"]);
const remoteCommit = output("git", [
  "ls-remote",
  "--exit-code",
  "origin",
  "refs/heads/main",
]).split(/\s/u)[0];

if (commit !== remoteCommit) {
  console.error(
    "Local main does not match origin/main. Merge changes through a PR, then update local main before deploying. This script never pushes code.",
  );
  process.exit(1);
}

run("ssh", [
  remoteHost,
  `git -C ${remoteDeployRoot} pull --ff-only && ${remoteDeployRoot}/scripts/deploy-${deployTargets[service] ?? service}`,
]);
