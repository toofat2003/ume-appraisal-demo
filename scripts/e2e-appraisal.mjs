import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";

const HOST = "127.0.0.1";
const TEST_IMAGES = [
  "test_pictures/watch/S__35241987_0.jpg",
  "test_pictures/watch/S__35241988_0.jpg",
  "test_pictures/watch/S__35241989_0.jpg",
];
const SLOT_LABELS = ["全体", "識別情報", "状態情報"];

function log(message) {
  process.stdout.write(`${message}\n`);
}

async function findOpenPort() {
  const server = createServer();
  server.listen(0, HOST);
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

  if (!port) {
    throw new Error("E2E用の空きポートを取得できませんでした。");
  }

  return port;
}

async function waitForServer(baseUrl, child) {
  const startedAt = Date.now();
  const timeoutMs = 30_000;

  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`Next dev server exited early with code ${child.exitCode}`);
    }

    try {
      const response = await fetch(baseUrl, { cache: "no-store" });
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error("Next dev server did not become ready within 30s.");
}

async function appendImage(form, relativePath, index) {
  const absolutePath = path.resolve(relativePath);
  const buffer = await readFile(absolutePath);
  const filename = path.basename(absolutePath);
  form.append("images", new Blob([buffer], { type: "image/jpeg" }), filename);
  form.append("imageSlotLabels", SLOT_LABELS[index] || `写真${index + 1}`);
}

async function postAppraisal(baseUrl, imagePaths, label) {
  const form = new FormData();

  for (const [index, imagePath] of imagePaths.entries()) {
    await appendImage(form, imagePath, index);
  }

  form.append("appointmentId", `e2e-${Date.now()}-${label}`);
  form.append("appointmentLabel", `E2E ${label}`);

  const response = await fetch(`${baseUrl}/api/appraisal`, {
    method: "POST",
    body: form,
    headers: {
      "x-client-session-id": `e2e-${Date.now()}`,
    },
  });
  const responseText = await response.text();
  let payload;

  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new Error(`Appraisal response was not JSON: ${responseText.slice(0, 500)}`);
  }

  if (!response.ok) {
    throw new Error(
      `Appraisal ${label} failed with ${response.status}: ${JSON.stringify(payload).slice(0, 1000)}`
    );
  }

  if (!payload.identification?.itemName) {
    throw new Error(`Appraisal ${label} did not return itemName.`);
  }

  if (!Number.isFinite(payload.pricing?.suggestedMaxPrice) || payload.pricing.suggestedMaxPrice <= 0) {
    throw new Error(`Appraisal ${label} did not return a positive suggestedMaxPrice.`);
  }

  if (!Array.isArray(payload.listings) || payload.listings.length === 0) {
    throw new Error(`Appraisal ${label} did not return listings.`);
  }

  log(
    [
      `E2E ${label}: ok`,
      `provider=${payload.debug?.identificationProvider || "unknown"}`,
      `item="${payload.identification.itemName}"`,
      `listings=${payload.pricing.listingCount}`,
      `max=$${payload.pricing.suggestedMaxPrice}`,
    ].join(" | ")
  );

  return payload;
}

async function main() {
  if (process.env.E2E_BASE_URL) {
    const baseUrl = process.env.E2E_BASE_URL.replace(/\/+$/, "");
    log(`Using existing app: ${baseUrl}`);
    await postAppraisal(baseUrl, [TEST_IMAGES[0]], "single-image");
    await postAppraisal(baseUrl, TEST_IMAGES, "three-images");
    log("E2E appraisal flow passed.");
    return;
  }

  const port = Number(process.env.E2E_PORT || 0) || await findOpenPort();
  const baseUrl = `http://${HOST}:${port}`;
  const child = spawn("npm", ["run", "dev", "--", "--hostname", HOST, "--port", String(port)], {
    env: {
      ...process.env,
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs = [];

  child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()));

  try {
    await waitForServer(baseUrl, child);
    await postAppraisal(baseUrl, [TEST_IMAGES[0]], "single-image");
    await postAppraisal(baseUrl, TEST_IMAGES, "three-images");
    log("E2E appraisal flow passed.");
  } catch (error) {
    log(logs.join("").slice(-4000));
    throw error;
  } finally {
    child.kill("SIGINT");
  }
}

await main();
