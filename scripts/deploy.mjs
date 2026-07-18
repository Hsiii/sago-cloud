import { execFileSync, spawnSync } from "node:child_process";

const service = process.argv[2] ?? "all";
const allowedServices = new Set([
  "all",
  "proxy",
  "wm31",
  "brawlstars",
  "morning",
  "recipe",
  "homepage",
  "postgres",
]);
const remoteHost = process.env.PLATFORM_HOST ?? "platform";
const remoteDeployRoot =
  process.env.PLATFORM_INFRA_ROOT ?? "/srv/platform/infra";

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
  console.error(`Deploy from main. Current branch is ${branch || "(detached)"}.`);
  process.exit(1);
}

if (output("git", ["status", "--porcelain"])) {
  console.error("Commit or stash local changes before deploying.");
  process.exit(1);
}

run("git", ["push", "origin", branch]);
run("ssh", [remoteHost, `${remoteDeployRoot}/scripts/deploy-${service}`]);
