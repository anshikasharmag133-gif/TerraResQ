# TerraResQ — Multimodal AI Hackathon 2026 (Track B)

**Track B Challenge:** *“Mapping Flood Damage from Space”* — helping rescuers understand where damage is and who is cut off when roads, bridges, and phone lines fail.

---

## 1. Challenge vs. Project Owner Architecture

- **Track B Challenge Scope:** Help emergency responders inspect satellite imagery, map possible flood impact, see exposed infrastructure, and identify settlements that may be disconnected from towns or hospitals.
- **Project Owner Implementation Scope:** In addition to the core Track B challenge, this project implements specific owner-defined engineering requirements:
  - User-selectable area and event date, plus a dedicated case-study configuration for the **Trishuli Corridor, Nepal (August 2026)**.
  - Sentinel-1 and Sentinel-2 imagery workflows, starting with a client-side **Sentinel-1 VV (dB) GeoTIFF Baseline Workbench** and an isolated **AI Flood-Segmentation Pathway** (`training/`).
  - Dated **pre-event** OpenStreetMap overlay for buildings, roads, bridges, settlements, towns, and hospitals.
  - Road-graph connectivity analysis with explicit, adjustable impassability assumptions.
  - Strictly isolated **EMSR927** post-freeze validation comparator.
  - Deterministic **One-Page Situation Report** (usable completely without Gemini or OpenAI API calls).

---

## 2. Running Locally in VS Code on Windows (Exported ZIP) & AI Studio

This web application uses a lightweight React + TypeScript + Vite + Express (`server.ts`) stack without heavy Python ML dependencies in the web runtime.

### Local Windows (VS Code) Setup & Exact PowerShell Commands
1. Extract the exported project ZIP and open the root folder in **VS Code**.
2. Open a terminal in VS Code (`Terminal -> New Terminal` or `Ctrl + Shift + ~`):
   ```powershell
   # 1. Verify Node.js (v18+ or v20+ recommended)
   node -v
   npm -v

   # 2. Install all dependencies (installs tsx, vite, leaflet, express, geotiff, etc.)
   npm install

   # 3. Verify TypeScript build
   npm run lint

   # 4. Start the development server
   npm run dev
   ```
3. Open your web browser to:
   **`http://localhost:3000`**
   *(Note: Never navigate to `http://0.0.0.0:3000`, as Chromium-based browsers reject `0.0.0.0` as an invalid IP address `ERR_ADDRESS_INVALID`)*.

4. **Production Build & Preview:**
   ```powershell
   # Build production client bundle
   npm run build

   # Run production full-stack server
   npm start
   ```

5. *(Optional)* For authenticated Copernicus Data Space downloads, configure `COPERNICUS_CLIENT_ID` and `COPERNICUS_CLIENT_SECRET` in `.env` (copy from `.env.example`). The application functions in offline/demo mode without any API keys or credentials.

### Troubleshooting Common Errors

- **`ERR_ADDRESS_INVALID`:**
  - Occurs if a browser tries to load `http://0.0.0.0:3000`.
  - Fix: Always open **`http://localhost:3000`** or `http://127.0.0.1:3000`. The server is configured to report and direct to `http://localhost:3000`.

- **`EADDRINUSE: address already in use :::3000`:**
  - Occurs if a prior Node.js server or background process is still bound to port 3000.
  - Fix in Windows PowerShell:
    ```powershell
    # Find process ID using port 3000
    Get-Process -Id (Get-NetTCPConnection -LocalPort 3000).OwningProcess
    # Terminate process if it is a stale node process
    Stop-Process -Id (Get-NetTCPConnection -LocalPort 3000).OwningProcess -Force
    ```
  - Alternative: Specify a custom port via environment variable:
    ```powershell
    $env:PORT="3001"; npm run dev
    ```

- **`tsx is not recognized as an internal or external command`:**
  - Occurs when running `npm run dev` before `npm install` has completed.
  - Fix: Run `npm install` first. `tsx` is declared in `devDependencies` in `package.json` and is invoked via npm scripts.

- **Port 24678 WebSocket / Duplicate Server Notice:**
  - Vite uses internal ports for HMR in standard configurations. In AI Studio, HMR is disabled via `DISABLE_HMR=true` to prevent WebSocket port collision. No external WebSocket server on port 24678 is required.

---

## 2.1 How to Load Demo Data & Run Analysis

### Load Sample Flood Scenario (1-Click)
1. Click the **`Load Trishuli Benchmark (1-Click)`** or **`Load Synthetic Demo [synthetic demo]`** button on the dashboard header.
2. The benchmark instantly loads:
   - Co-registered pre-event (2026-08-01) and post-event (2026-08-14) Sentinel-1 SAR backscatter rasters.
   - High-resolution post-event optical imagery for visual cross-validation.
   - Pre-event OpenStreetMap infrastructure extract (roads, bridges, buildings, settlements, hospitals, towns).
   - Kuro Siwo reference flood extent labels (for strict validation comparison).

### Run Analysis Workflow
1. Switch to the **`Before/After SAR & Optical Analysis`** or **`GeoTIFF Baseline Workbench`** tab.
2. Select or customize your backscatter threshold (default: `-16.0 dB`) and minimum backscatter drop (default: `3.0 dB`).
3. Click the **`Run Analysis`** button:
   - Validates CRS, bounding box, dimensions, and NoData values.
   - Computes pixel-wise backscatter difference and candidate water mask.
   - Calculates defensible flooded area in $\text{km}^2$ and hectares based on spatial pixel scale.
   - Evaluates road exposure and bridges intersecting candidate water pixels.
   - Solves road-network connectivity and tags candidate cut-off settlements.
   - Updates the live **Interactive Map Legend**, symbology layers, and provenance telemetry strip.
4. Click **`Generate Situation Report`** to generate and export an automated, deterministic PDF/text situation report.

---

## 3. First Working Milestone: Co-Registered Sentinel-1 VV GeoTIFFs (dB)

Implemented in `src/services/geotiffProcessor.ts` and `src/components/GeoTiffWorkbenchPanel.tsx`:

1. **Upload Pre-Event & Post-Event Rasters:** Accepts `.tif` / `.tiff` rasters using `geotiff.js`.
2. **7-Point Co-Registration & Metadata Validation:**
   - Validates file extension/TIFF binary header, CRS (`ProjectedCSTypeGeoKey` / `GeographicTypeGeoKey`), affine transform (`ModelPixelScale` and `ModelTiepoint`), grid dimensions (`width`, `height`), band count (`1` band expected for VV), `nodata` handling, and declared units (`dB` within plausible physical backscatter bounds `[-60, +35] dB`).
   - Rejects incompatible rasters with plain-language diagnostic errors (testable anytime via the **"Test Incompatible Raster Rejection"** button).
3. **Low-Backscatter Water-Candidate Mask:**
   - Applies a user-adjustable dB threshold ($T_{\text{dB}}$) and minimum post-event backscatter drop ($\Delta\text{dB}$):
     $$\text{Candidate}(i) \iff \text{Post}_{\text{dB}}(i) \le T_{\text{dB}} \;\land\; \text{Pre}_{\text{dB}}(i) > T_{\text{dB}} \;\land\; (\text{Post}_{\text{dB}}(i) - \text{Pre}_{\text{dB}}(i)) \le -\Delta\text{dB}$$
   - Explicitly labelled **`baseline only, not AI and not validated`**.
4. **Defensible Area Calculation:**
   - Reports candidate pixel count for all valid rasters, and computes metric area ($\text{m}^2$ and $\text{km}^2$) **only** when the CRS and pixel scale support a defensible metric area calculation (e.g., UTM Zone 45N `EPSG:32645`).
5. **Georeferenced GeoTIFF Export:**
   - Exports the binary water-candidate mask as a valid georeferenced `.tif` preserving `EPSG` CRS keys, `ModelPixelScale`, and `ModelTiepoint`.
6. **Isolated Synthetic Demo Option:**
   - Includes a **"Load Synthetic Demo [synthetic demo]"** button that generates a co-registered synthetic UTM 45N GeoTIFF pair and synthetic pre-event OSM graph in memory, visibly marked `synthetic demo` and never mixed with real Trishuli case-study results.

---

## 4. AI Segmentation Pathway (`training/`)

Heavy Python ML dependencies (`torch`, `rasterio`, `onnx`, `scikit-learn`) are isolated in `training/requirements-training.txt`:

- `training/dataset_splits.py`: Enforces geographic / event-based disjoint `train`, `val`, and held-out `test` splits so patches from the same scene are never mixed across splits. Prohibits EMSR927, Copernicus EMS, UNOSAT, and post-event OSM.
- `training/train_unet.py`: Trains `SmallFloodUNet` on permitted datasets (**Sen1Floods11** or **Kuro Siwo**, subject to confirming current access terms and attribution) and exports a verifiable `model_metadata.json` provenance manifest.
- `training/inference_cli.py`: Reproducible CLI inference runner recording SHA-256 hashes of inputs and outputs.
- **Web App Behavior:** Until a user supplies both a model file (`.onnx` / `.pt`) and a valid `model_metadata.json` manifest, the web app explicitly displays **`AI model not installed`** (`status: "not assessed"`) and offers the dB threshold baseline separately.

---

## 5. Satellite Scene Discovery (Copernicus Data Space Catalogue)

Implemented in `server.ts` (`/api/copernicus/search`) and `src/components/SceneDiscoveryPanel.tsx`:
- Queries the official **Copernicus Data Space Ecosystem (CDSE) STAC API** (`https://catalogue.dataspace.copernicus.eu/stac/search`) by area bounding box, date range, sensor (`SENTINEL-1` / `SENTINEL-2`), and polarization.
- Displays scene identifiers, acquisition dates, orbit direction/track, polarization, bounding box coverage, and access status (`status: "catalog result"`).
- Does not automatically download large scenes; keeps the manual GeoTIFF upload workflow usable offline or without credentials.

---

## 6. Pre-Event OSM Exposure & Road-Graph Isolation

Implemented in `src/services/geospatialPipeline.ts` and `src/components/CutoffNetworkPanel.tsx`:
- Requires a **dated pre-event OpenStreetMap extract** (`extract_date` strictly prior to `eventDate`). Undated or post-event OSM files are rejected. If no extract is loaded, infrastructure and isolation metrics report **`not assessed`**.
- Assets intersecting or lying within the user's buffer of flood candidates are reported as **exposure estimates** (`EXPOSED`), never as confirmed structural damage.
- Builds a topological graph from supplied roads, applies an explicit, adjustable **Impassability Rule** (marked as an assumption), and identifies candidate settlements cut off from the nearest supplied town or hospital.

---

## 7. Validation Separation (EMSR927)

Implemented in `src/components/TrishuliCaseStudyPanel.tsx`:
- Enforces a 2-step gate:
  1. **Freeze Outputs & Parameters:** Locks a snapshot hash of the active non-synthetic mask and threshold parameters.
  2. **Compare with EMSR927:** Only unlocks EMSR927 reference GeoJSON upload *after* outputs are frozen, preventing EMSR927 from entering training, tuning, or inference.

---

## 8. Target Submission Materials & Data Attributions

Target submission package:
- Public GitHub repository & this `README.md`
- Technical report (at most 6 pages)
- 3-minute demonstration video
- Data attributions (below)
- *Note: The separate official submission-guidelines document still needs checking before final submission.*

### Mandatory Data Attributions
- **"Contains modified Copernicus Sentinel data 2026."**
- **"Produced using Copernicus WorldDEM-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018 provided under COPERNICUS by the European Union and ESA; all rights reserved."**
- **"© OpenStreetMap contributors."**
