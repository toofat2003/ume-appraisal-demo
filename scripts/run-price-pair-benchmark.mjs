import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";

const HOST = "127.0.0.1";
const DATASET_PATH =
  process.env.PRICE_PAIR_DATASET ||
  "datasets/price_pair_benchmark_2026-04-22/dataset.json";
const PROVIDER = process.env.APPRAISAL_IMAGE_PROVIDER || "google-vision";
const INCLUDE_PRICE_IMAGE = process.env.BENCHMARK_INCLUDE_PRICE_IMAGE === "1";

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
    throw new Error("Benchmark server port could not be allocated.");
  }

  return port;
}

async function waitForServer(baseUrl, child) {
  const startedAt = Date.now();
  const timeoutMs = 45_000;

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

  throw new Error("Next dev server did not become ready within 45s.");
}

async function appendImage(form, imagePath, slotLabel) {
  const buffer = await readFile(imagePath);
  form.append("images", new Blob([buffer], { type: "image/jpeg" }), path.basename(imagePath));
  form.append("imageSlotLabels", slotLabel);
}

async function postAppraisal(baseUrl, imagePaths, entry) {
  const form = new FormData();

  for (const imagePath of imagePaths) {
    await appendImage(form, imagePath.path, imagePath.slotLabel);
  }

  form.append("appointmentId", `price-pair-benchmark-${Date.now()}`);
  form.append("appointmentLabel", `Price Pair Benchmark ${entry.id}`);

  const response = await fetch(`${baseUrl}/api/appraisal`, {
    method: "POST",
    body: form,
    headers: {
      "x-client-session-id": `price-pair-benchmark-${Date.now()}`,
    },
  });
  const responseText = await response.text();
  let payload;

  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new Error(`${entry.id}: response was not JSON: ${responseText.slice(0, 500)}`);
  }

  if (!response.ok) {
    throw new Error(`${entry.id}: appraisal failed ${response.status}: ${JSON.stringify(payload)}`);
  }

  return payload;
}

function percentError(actual, expected) {
  if (!Number.isFinite(actual) || !Number.isFinite(expected) || expected === 0) {
    return null;
  }

  return ((actual - expected) / expected) * 100;
}

function round(value, digits = 1) {
  if (!Number.isFinite(value)) {
    return null;
  }

  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function summarizeRow(entry, payload, elapsedMs) {
  const pricing = payload.pricing || {};
  const reference = entry.referencePriceUsd;
  const median = Number(pricing.median || 0);
  const p25 = Number(pricing.low || 0);
  const p75 = Number(pricing.high || 0);
  const medianErrorPct = percentError(median, reference);

  return {
    id: entry.id,
    benchmarkStatus: entry.benchmarkStatus,
    productImage: entry.productImage,
    priceImage: entry.priceImage,
    expectedItemName: entry.itemNameFromTag,
    identifiedItemName: payload.identification?.itemName || "",
    searchQuery: payload.identification?.searchQuery || "",
    provider: payload.debug?.identificationProvider || "unknown",
    confidence: round(Number(payload.identification?.confidence || 0), 2),
    referencePriceUsd: reference,
    ebayP25Usd: p25,
    ebayMedianUsd: median,
    ebayP75Usd: p75,
    medianErrorPct: round(medianErrorPct, 1),
    medianWithin30Pct: medianErrorPct !== null ? Math.abs(medianErrorPct) <= 30 : false,
    referenceWithinIqr: Number.isFinite(p25) && Number.isFinite(p75) && reference >= p25 && reference <= p75,
    listingCount: Number(pricing.listingCount || 0),
    suggestedMaxPriceUsd: Number(pricing.suggestedMaxPrice || 0),
    elapsedMs,
    warnings: payload.warnings || [],
    topListings: Array.isArray(payload.listings)
      ? payload.listings.slice(0, 5).map((listing) => ({
          title: listing.title,
          totalPrice: listing.totalPrice?.amount || 0,
          url: listing.itemWebUrl,
        }))
      : [],
  };
}

function buildMarkdown(dataset, rows) {
  const includeRows = rows.filter((row) => row.benchmarkStatus === "include");
  const allMedianWithin30 = rows.filter((row) => row.medianWithin30Pct).length;
  const includeMedianWithin30 = includeRows.filter((row) => row.medianWithin30Pct).length;
  const allIqrHits = rows.filter((row) => row.referenceWithinIqr).length;
  const includeIqrHits = includeRows.filter((row) => row.referenceWithinIqr).length;
  const meanAbsMedianError = round(
    rows.reduce((sum, row) => sum + Math.abs(row.medianErrorPct ?? 0), 0) / rows.length,
    1
  );
  const includeMeanAbsMedianError = round(
    includeRows.reduce((sum, row) => sum + Math.abs(row.medianErrorPct ?? 0), 0) /
      Math.max(1, includeRows.length),
    1
  );

  const lines = [
    `# ${dataset.datasetId} Benchmark Run`,
    "",
    `- Provider target: ${PROVIDER}`,
    `- Input mode: ${INCLUDE_PRICE_IMAGE ? "product + price tag image" : "product image only"}`,
    `- Total entries: ${rows.length}`,
    `- Include entries: ${includeRows.length}`,
    `- Median within +/-30%: ${allMedianWithin30}/${rows.length}`,
    `- Median within +/-30% on include rows: ${includeMedianWithin30}/${includeRows.length}`,
    `- Reference price within eBay IQR: ${allIqrHits}/${rows.length}`,
    `- Reference price within eBay IQR on include rows: ${includeIqrHits}/${includeRows.length}`,
    `- Mean absolute median error: ${meanAbsMedianError}%`,
    `- Mean absolute median error on include rows: ${includeMeanAbsMedianError}%`,
    "",
    "| ID | Status | Expected | Identified | Query | Ref | eBay p25 | eBay median | eBay p75 | Median Error | IQR Hit | Listings |",
    "| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |",
  ];

  for (const row of rows) {
    lines.push(
      `| ${[
        row.id,
        row.benchmarkStatus,
        row.expectedItemName.replaceAll("|", "/"),
        row.identifiedItemName.replaceAll("|", "/"),
        row.searchQuery.replaceAll("|", "/"),
        `$${row.referencePriceUsd}`,
        `$${row.ebayP25Usd}`,
        `$${row.ebayMedianUsd}`,
        `$${row.ebayP75Usd}`,
        `${row.medianErrorPct}%`,
        row.referenceWithinIqr ? "yes" : "no",
        row.listingCount,
      ].join(" | ")} |`
    );
  }

  lines.push("", "## Top Listings");

  for (const row of rows) {
    lines.push("", `### ${row.id} ${row.identifiedItemName}`, "");
    for (const listing of row.topListings) {
      lines.push(`- $${listing.totalPrice}: ${listing.title}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

async function runBenchmark(baseUrl, dataset, datasetDir) {
  const rows = [];

  for (const entry of dataset.entries) {
    const imagePaths = [
      {
        path: path.resolve(datasetDir, entry.productImage),
        slotLabel: "品物",
      },
    ];

    if (INCLUDE_PRICE_IMAGE) {
      imagePaths.push({
        path: path.resolve(datasetDir, entry.priceImage),
        slotLabel: "価格タグ",
      });
    }

    const startedAt = Date.now();
    log(`Running ${entry.id}: ${entry.itemNameFromTag}`);
    const payload = await postAppraisal(baseUrl, imagePaths, entry);
    const row = summarizeRow(entry, payload, Date.now() - startedAt);
    rows.push(row);
    log(
      `  -> ${row.identifiedItemName} | median=$${row.ebayMedianUsd} | ref=$${row.referencePriceUsd} | error=${row.medianErrorPct}%`
    );
  }

  return rows;
}

async function main() {
  const datasetPath = path.resolve(DATASET_PATH);
  const datasetDir = path.dirname(datasetPath);
  const dataset = JSON.parse(await readFile(datasetPath, "utf8"));
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runsDir = path.join(datasetDir, "runs");
  await mkdir(runsDir, { recursive: true });

  let baseUrl = process.env.E2E_BASE_URL?.replace(/\/+$/, "");
  let child = null;
  const logs = [];

  if (!baseUrl) {
    const port = Number(process.env.E2E_PORT || 0) || await findOpenPort();
    baseUrl = `http://${HOST}:${port}`;
    child = spawn("npm", ["run", "dev", "--", "--hostname", HOST, "--port", String(port)], {
      env: {
        ...process.env,
        APPRAISAL_IMAGE_PROVIDER: PROVIDER,
        PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
    child.stderr.on("data", (chunk) => logs.push(chunk.toString()));
    await waitForServer(baseUrl, child);
  }

  try {
    const rows = await runBenchmark(baseUrl, dataset, datasetDir);
    const result = {
      runId,
      datasetId: dataset.datasetId,
      providerTarget: PROVIDER,
      includePriceImage: INCLUDE_PRICE_IMAGE,
      baseUrl,
      rows,
    };
    const jsonPath = path.join(runsDir, `${runId}.json`);
    const mdPath = path.join(runsDir, `${runId}.md`);
    await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
    await writeFile(mdPath, buildMarkdown(dataset, rows));
    log(`Benchmark JSON: ${jsonPath}`);
    log(`Benchmark report: ${mdPath}`);
  } catch (error) {
    if (logs.length > 0) {
      log(logs.join("").slice(-4000));
    }
    throw error;
  } finally {
    if (child) {
      child.kill("SIGINT");
    }
  }
}

await main();
