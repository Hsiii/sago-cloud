import { createHash, timingSafeEqual } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

const port = positiveInteger("PORT", 3000);
const mediaRoot = process.env.PR_MEDIA_ROOT ?? "/srv/pr-media";
const tokenDirectory =
  process.env.PR_MEDIA_TOKEN_DIR ?? "/run/secrets/pr-media-tokens";
const uploadCommand =
  process.env.PR_MEDIA_UPLOAD_COMMAND ?? "/usr/local/bin/pr-media-upload";
const dailyByteLimit = positiveInteger(
  "PR_MEDIA_DAILY_BYTES_PER_TOKEN",
  500_000_000,
);
const dailyUploadLimit = positiveInteger(
  "PR_MEDIA_DAILY_UPLOADS_PER_TOKEN",
  50,
);
const requestByteLimit = positiveInteger(
  "PR_MEDIA_MAX_REQUEST_BYTES",
  95_000_000,
);
const concurrentUploadLimit = positiveInteger(
  "PR_MEDIA_MAX_CONCURRENT_UPLOADS",
  2,
);
const supportedExtensions = new Set([
  "gif",
  "jpeg",
  "jpg",
  "mp4",
  "png",
  "webm",
  "webp",
]);

let activeUploads = 0;

function positiveInteger(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function reply(body: string, status = 200, extraHeaders?: HeadersInit) {
  return new Response(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function loadTokens() {
  const tokens: Array<{ digest: Buffer; name: string }> = [];

  for (const entry of readdirSync(tokenDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(entry.name)) {
      continue;
    }

    const digest = readFileSync(
      join(tokenDirectory, entry.name),
      "utf8",
    ).trim();
    if (!/^[0-9a-f]{64}$/.test(digest)) {
      continue;
    }

    tokens.push({ digest: Buffer.from(digest, "hex"), name: entry.name });
  }

  return tokens;
}

function authenticate(request: Request, tokens: ReturnType<typeof loadTokens>) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(authorization);
  if (!match) {
    return;
  }

  const presented = createHash("sha256").update(match[1]).digest();
  return tokens.find(({ digest }) => timingSafeEqual(digest, presented))?.name;
}

function reserveQuota(actor: string, bytes: number) {
  const date = new Date().toISOString().slice(0, 10);
  const quotaDirectory = join(mediaRoot, ".api-usage", date);
  const quotaPath = join(quotaDirectory, `${actor}.json`);
  let usage = { bytes: 0, uploads: 0 };

  mkdirSync(quotaDirectory, { recursive: true });
  try {
    const storedUsage = JSON.parse(readFileSync(quotaPath, "utf8"));
    if (
      !Number.isSafeInteger(storedUsage.bytes) ||
      storedUsage.bytes < 0 ||
      !Number.isSafeInteger(storedUsage.uploads) ||
      storedUsage.uploads < 0
    ) {
      throw new Error("Stored upload quota is invalid");
    }
    usage = storedUsage;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  if (
    usage.bytes + bytes > dailyByteLimit ||
    usage.uploads + 1 > dailyUploadLimit
  ) {
    return false;
  }

  const nextUsage = {
    bytes: usage.bytes + bytes,
    uploads: usage.uploads + 1,
  };
  const temporaryPath = `${quotaPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(nextUsage)}\n`, {
    mode: 0o600,
  });
  renameSync(temporaryPath, quotaPath);
  return true;
}

async function writeRequestBody(request: Request, destination: string) {
  if (!request.body) {
    throw new Error("Request body is required");
  }

  const writer = Bun.file(destination).writer();
  const reader = request.body.getReader();
  let received = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      received += value.byteLength;
      if (received > requestByteLimit) {
        throw new Error("Request body exceeds the upload limit");
      }
      writer.write(value);
    }
  } finally {
    await writer.end();
  }

  return received;
}

async function upload(request: Request) {
  let tokens: ReturnType<typeof loadTokens>;
  try {
    tokens = loadTokens();
  } catch {
    return reply("Upload credentials are unavailable.\n", 503);
  }

  if (tokens.length === 0) {
    return reply("Upload credentials are unavailable.\n", 503);
  }

  const actor = authenticate(request, tokens);
  if (!actor) {
    return reply("Unauthorized.\n", 401, {
      "WWW-Authenticate": "Bearer",
    });
  }

  const repo = request.headers.get("x-pr-media-repo") ?? "";
  const pr = request.headers.get("x-pr-media-pr") ?? "";
  const filename = basename(request.headers.get("x-pr-media-filename") ?? "");
  const extension = filename.split(".").at(-1)?.toLowerCase() ?? "";
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) ||
    !/^[1-9][0-9]*$/.test(pr) ||
    !supportedExtensions.has(extension)
  ) {
    return reply("Invalid repository, PR number, or filename.\n", 400);
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
    return reply("Content-Length is required.\n", 411);
  }
  if (contentLength > requestByteLimit) {
    return reply("Upload exceeds the request size limit.\n", 413);
  }
  if (activeUploads >= concurrentUploadLimit) {
    return reply("Too many uploads are active; retry shortly.\n", 429, {
      "Retry-After": "10",
    });
  }

  try {
    if (!reserveQuota(actor, contentLength)) {
      return reply("Daily upload quota exceeded.\n", 429, {
        "Retry-After": "86400",
      });
    }
  } catch {
    return reply("Upload quota is unavailable.\n", 503);
  }

  activeUploads += 1;
  const temporaryDirectory = mkdtempSync("/tmp/pr-media-api.");
  const sourcePath = join(temporaryDirectory, `upload.${extension}`);

  try {
    const received = await writeRequestBody(request, sourcePath);
    if (received !== contentLength) {
      return reply("Content-Length did not match the uploaded body.\n", 400);
    }

    const child = Bun.spawn(
      [uploadCommand, "--repo", repo, "--pr", pr, sourcePath],
      {
        env: process.env,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (status !== 0) {
      console.warn(
        JSON.stringify({
          actor,
          event: "upload_rejected",
          pr,
          repo,
          status,
        }),
      );
      return reply(`${stderr.trim().slice(0, 2000)}\n`, 422);
    }

    console.info(
      JSON.stringify({
        actor,
        bytes: received,
        event: "upload_completed",
        pr,
        repo,
      }),
    );
    return reply(`${stdout.trim()}\n`, 201);
  } finally {
    activeUploads -= 1;
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return reply("ok\n");
    }
    if (request.method === "POST" && url.pathname === "/api/upload") {
      return upload(request);
    }
    return reply("Not found.\n", 404);
  },
});
