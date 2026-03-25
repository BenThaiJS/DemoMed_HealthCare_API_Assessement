# DemoMed Healthcare API Assessment

Simple instructions for running the solution.

## Prerequisites

- Node.js 18+ and npm installed.
- Your DemoMed assessment API key.

## 1. Install dependencies

From the project root:

```bash
npm install
```

## 2. Set your API key (PowerShell)

```powershell
$env:DEMOMED_API_KEY = "your-api-key-here"
```

## 3. Run the script

**Just compute and print the lists (no submission):**

```bash
npm start
```

**Compute and submit to the assessment API:**

```bash
npm run submit
```

`index.js` will:

- Fetch all patients from the DemoMed API.
- Compute risk scores (blood pressure, temperature, age).
- Print the three alert lists.
- When run with `npm run submit`, POST the lists to the assessment API and print the response.
