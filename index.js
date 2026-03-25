// DemoMed Healthcare API Assessment Solution
// Usage:
//   On Windows PowerShell:
//     $env:DEMOMED_API_KEY = "your-api-key-here"
//     npm install
//     npm start           # just compute and print lists
//     npm run submit      # compute lists and submit assessment

const API_BASE = "https://assessment.ksensetech.com/api";
const API_KEY = "ak_51f8df01357dfb5331d573db8a72707ee78bd970c8874c43";

if (!API_KEY) {
  console.warn("WARNING: DEMOMED_API_KEY is not set. Set it before running.");
}

/**
 * Generic fetch with retry for 429 / 500 / 503 and network errors.
 * Uses exponential backoff with jitter.
 */

async function fetchWithRetry(path, { method = "GET", headers = {}, body } = {}, maxRetries = 5) {
  const url = `${API_BASE}${path}`;
  let attempt = 0;

  while (true) {
    try {
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": API_KEY || "",
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if ([429, 500, 503].includes(res.status)) {
        if (attempt >= maxRetries) {
          throw new Error(`Request failed after ${maxRetries} retries with status ${res.status}`);
        }

        let delayMs;
        const retryAfter = res.headers.get("retry-after");
        if (retryAfter) {
          const asNumber = Number(retryAfter);
          delayMs = !Number.isNaN(asNumber) ? asNumber * 1000 : 1000;
        } else {
          const base = 500 * Math.pow(2, attempt); // 500, 1000, 2000, ...
          const jitter = Math.random() * 250;
          delayMs = base + jitter;
        }

        await new Promise((resolve) => setTimeout(resolve, delayMs));
        attempt += 1;
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${text}`);
      }

      // Try to parse JSON; if it fails, throw
      try {
        return await res.json();
      } catch (e) {
        throw new Error(`Failed to parse JSON response: ${e.message}`);
      }
    } catch (err) {
      if (attempt >= maxRetries) {
        throw err;
      }
      const base = 500 * Math.pow(2, attempt);
      const jitter = Math.random() * 250;
      const delayMs = base + jitter;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      attempt += 1;
    }
  }
}

/**
 * Fetch all patients, handling pagination and occasional missing/odd fields.
 */
async function fetchAllPatients(limit = 10) {
  const patients = [];
  let page = 1;
  let hasNext = true;

  while (hasNext) {
    const query = `?page=${page}&limit=${limit}`;
    const data = await fetchWithRetry(`/patients${query}`);

    const pagePatients = Array.isArray(data?.data) ? data.data : [];
    for (const p of pagePatients) {
      if (p && p.patient_id) {
        patients.push(p);
      }
    }

    const pagination = data?.pagination;
    if (pagination && typeof pagination === "object") {
      hasNext = Boolean(pagination.hasNext);
      page = (pagination.page || page) + 1;
    } else {
      hasNext = pagePatients.length === limit;
      page += 1;
    }

    if (page > 100) {
      console.warn("Stopping pagination after 100 pages for safety.");
      break;
    }
  }

  return patients;
}

function parseBloodPressure(raw) {
  if (!raw || typeof raw !== "string") return { valid: false };

  const cleaned = raw.trim();
  if (!cleaned) return { valid: false };

  const match = cleaned.match(/(\d+)\s*[/\- ]\s*(\d+)/);
  if (!match) return { valid: false };

  const systolic = Number.parseInt(match[1], 10);
  const diastolic = Number.parseInt(match[2], 10);

  if (Number.isNaN(systolic) || Number.isNaN(diastolic)) return { valid: false };

  return { valid: true, systolic, diastolic };
}

function scoreBloodPressure(bpRaw) {
  const parsed = parseBloodPressure(bpRaw);
  if (!parsed.valid) return { score: 0, valid: false };

  const { systolic: s, diastolic: d } = parsed;

  if (s < 120 && d < 80) return { score: 1, valid: true };
  if (s >= 120 && s <= 129 && d < 80) return { score: 2, valid: true };
  if ((s >= 130 && s <= 139) || (d >= 80 && d <= 89)) return { score: 3, valid: true };
  if (s >= 140 || d >= 90) return { score: 4, valid: true };

  return { score: 0, valid: true };
}

function scoreTemperature(tempRaw) {
  if (tempRaw === null || tempRaw === undefined || tempRaw === "") return { score: 0, valid: false };

  let t;
  if (typeof tempRaw === "number") t = tempRaw;
  else if (typeof tempRaw === "string") t = Number.parseFloat(tempRaw.trim());
  else return { score: 0, valid: false };

  if (Number.isNaN(t)) return { score: 0, valid: false };

  if (t <= 99.5) return { score: 0, valid: true, value: t };
  if (t >= 99.6 && t <= 100.9) return { score: 1, valid: true, value: t };
  if (t >= 101.0) return { score: 2, valid: true, value: t };

  return { score: 0, valid: true, value: t };
}

function scoreAge(ageRaw) {
  if (ageRaw === null || ageRaw === undefined || ageRaw === "") return { score: 0, valid: false };

  let age;
  if (typeof ageRaw === "number") age = ageRaw;
  else if (typeof ageRaw === "string") age = Number.parseInt(ageRaw.trim(), 10);
  else return { score: 0, valid: false };

  if (Number.isNaN(age) || age < 0) return { score: 0, valid: false };

  if (age > 65) return { score: 2, valid: true };
  return { score: 1, valid: true };
}

function computeRiskAndAlerts(patients) {
  const highRiskPatients = [];
  const feverPatients = [];
  const dataQualityIssues = [];

  for (const patient of patients) {
    const id = patient.patient_id;
    if (!id) continue;

    const { score: bpScore, valid: bpValid } = scoreBloodPressure(patient.blood_pressure);
    const tempResult = scoreTemperature(patient.temperature);
    const ageResult = scoreAge(patient.age);

    const totalRisk = bpScore + tempResult.score + ageResult.score;

    if (totalRisk >= 4) highRiskPatients.push(id);
    if (tempResult.valid && typeof tempResult.value === "number" && tempResult.value >= 99.6)
      feverPatients.push(id);
    if (!bpValid || !tempResult.valid || !ageResult.valid) dataQualityIssues.push(id);
  }

  const uniq = (arr) => {
    const seen = new Set();
    const result = [];
    for (const v of arr) if (!seen.has(v)) { seen.add(v); result.push(v); }
    return result;
  };

  return {
    high_risk_patients: uniq(highRiskPatients),
    fever_patients: uniq(feverPatients),
    data_quality_issues: uniq(dataQualityIssues),
  };
}

async function submitAssessment(payload) {
  if (!API_KEY) throw new Error("Cannot submit assessment: DEMOMED_API_KEY is not set.");

  const res = await fetchWithRetry("/submit-assessment", { method: "POST", body: payload });
  return res;
}

async function main() {
  try {
    console.log("Fetching patients from API...");
    const patients = await fetchAllPatients(10);
    console.log(`Fetched ${patients.length} patients.`);

    const alerts = computeRiskAndAlerts(patients);

    console.log("\nComputed alert lists:");
    console.log("High-risk patients (total risk >= 4):", alerts.high_risk_patients);
    console.log("Fever patients (temp >= 99.6°F):", alerts.fever_patients);
    console.log("Data quality issues:", alerts.data_quality_issues);

    const shouldSubmit = process.argv.includes("--submit");

    if (shouldSubmit) {
      console.log("\nSubmitting assessment to API...");
      const result = await submitAssessment(alerts);
      console.log("Submission response:");
      console.dir(result, { depth: null });
    } else {
      console.log("\nRun with --submit (or npm run submit) to POST results to the assessment API.");
    }
  } catch (err) {
    console.error("Error:", err.message || err);
    process.exitCode = 1;
  }
}

// Ensure global fetch is available (Node 18+) or fall back to node-fetch
if (typeof fetch === "undefined") {
  import("node-fetch")
    .then((mod) => {
      global.fetch = mod.default || mod;
      main();
    })
    .catch((err) => {
      console.error("Failed to load node-fetch. Run 'npm install node-fetch' first.");
      console.error(err);
      process.exitCode = 1;
    });
} else {
  main();
}