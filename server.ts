import express from 'express';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CopernicusSceneMetadata {
  id: string;
  collection: string;
  sensor: string;
  acquisitionDate: string;
  orbitDirection: string;
  relativeOrbitTrack: string | number;
  polarization: string;
  cloudCoverPercent: number | null;
  bbox: number[] | null;
  footprintCoverageNote: string;
  accessStatus: string;
  provenanceStatus: 'catalog result';
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const HOST = process.env.HOST || '0.0.0.0';

  app.use(express.json({ limit: '15mb' }));

  // 1. Health & Secrets Configuration Status (Never exposes secret values)
  app.get('/api/health', (_req, res) => {
    const hasCopernicusSecrets = Boolean(
      process.env.COPERNICUS_CLIENT_ID &&
        process.env.COPERNICUS_CLIENT_SECRET &&
        process.env.COPERNICUS_CLIENT_ID.trim() !== ''
    );
    res.json({
      service: 'TerraResQ — Multimodal AI Hackathon 2026 (Track B)',
      status: 'READY',
      copernicusCredentialsConfigured: hasCopernicusSecrets,
      timestamp: new Date().toISOString(),
    });
  });

  // 2. Official Copernicus Data Space Ecosystem (CDSE) STAC Metadata Discovery Proxy
  app.post('/api/copernicus/search', async (req, res) => {
    try {
      const {
        bbox = [85.1, 27.88, 85.42, 28.3], // [west, south, east, north] default Trishuli Corridor
        startDate = '2026-08-01',
        endDate = '2026-08-31',
        sensor = 'SENTINEL-1',
        polarization = 'VV',
        limit = 12,
      } = req.body || {};

      const hasCopernicusSecrets = Boolean(
        process.env.COPERNICUS_CLIENT_ID &&
          process.env.COPERNICUS_CLIENT_SECRET &&
          process.env.COPERNICUS_CLIENT_ID.trim() !== ''
      );

      const datetimeRange = `${startDate}T00:00:00Z/${endDate}T23:59:59Z`;
      const stacUrl = 'https://catalogue.dataspace.copernicus.eu/stac/search';

      const stacResponse = await fetch(stacUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/geo+json, application/json',
        },
        body: JSON.stringify({
          collections: [sensor === 'SENTINEL-2' ? 'SENTINEL-2' : 'SENTINEL-1'],
          bbox: Array.isArray(bbox) && bbox.length === 4 ? bbox.map(Number) : [85.1, 27.88, 85.42, 28.3],
          datetime: datetimeRange,
          limit: Math.min(25, Number(limit) || 12),
        }),
      });

      if (!stacResponse.ok) {
        const text = await stacResponse.text();
        res.status(502).json({
          error: `Copernicus Data Space STAC catalogue returned HTTP ${stacResponse.status}. Manual GeoTIFF upload workflow remains fully available.`,
          details: text.slice(0, 300),
          copernicusCredentialsConfigured: hasCopernicusSecrets,
        });
        return;
      }

      const stacData = (await stacResponse.json()) as {
        features?: Array<{
          id?: string;
          collection?: string;
          bbox?: number[];
          properties?: Record<string, unknown>;
        }>;
      };

      const rawFeatures = stacData.features || [];
      const scenes: CopernicusSceneMetadata[] = [];

      for (const feat of rawFeatures) {
        const props = feat.properties || {};
        const rawPol =
          props['sar:polarizations'] ||
          props['polarization'] ||
          props['polarisationChannels'] ||
          (sensor === 'SENTINEL-2' ? 'MSI 13-Band Optical' : 'VV / VH');

        const polStr = Array.isArray(rawPol) ? rawPol.join('+') : String(rawPol);

        // Filter by requested polarization for Sentinel-1 if specified
        if (
          sensor === 'SENTINEL-1' &&
          polarization &&
          polarization !== 'ANY' &&
          !polStr.toUpperCase().includes(polarization.toUpperCase())
        ) {
          continue;
        }

        const orbitDir = String(
          props['sat:orbit_state'] || props['orbitDirection'] || 'Not reported in STAC summary'
        );
        const relOrbit =
          (props['sat:relative_orbit'] as number | string) ||
          (props['relativeOrbitNumber'] as number | string) ||
          'N/A';

        const cloudCover =
          typeof props['eo:cloud_cover'] === 'number'
            ? Number((props['eo:cloud_cover'] as number).toFixed(1))
            : null;

        scenes.push({
          id: String(feat.id || 'Unknown_Scene_ID'),
          collection: String(feat.collection || sensor),
          sensor: sensor === 'SENTINEL-2' ? 'Sentinel-2 MSI' : 'Sentinel-1 C-Band SAR',
          acquisitionDate: String(props.datetime || 'Unknown date'),
          orbitDirection: orbitDir,
          relativeOrbitTrack: relOrbit,
          polarization: polStr,
          cloudCoverPercent: cloudCover,
          bbox: Array.isArray(feat.bbox) ? feat.bbox : null,
          footprintCoverageNote: Array.isArray(feat.bbox)
            ? `[${feat.bbox.map((n) => Number(n).toFixed(2)).join(', ')}]`
            : 'AOI Intersecting',
          accessStatus: hasCopernicusSecrets
            ? 'Online (OAuth2 server credentials configured)'
            : 'Online Catalogue Metadata (Full product download requires COPERNICUS_CLIENT_ID / SECRET in server Secrets)',
          provenanceStatus: 'catalog result',
        });
      }

      res.json({
        source: 'Official Copernicus Data Space Ecosystem (CDSE) STAC API',
        endpoint: stacUrl,
        query: { bbox, startDate, endDate, sensor, polarization },
        copernicusCredentialsConfigured: hasCopernicusSecrets,
        count: scenes.length,
        scenes,
      });
    } catch (error) {
      res.status(502).json({
        error:
          'Unable to reach Copernicus Data Space catalogue API from this environment. You can continue using the local GeoTIFF upload workflow.',
        details: error instanceof Error ? error.message : 'Network error',
      });
    }
  });

  // 3. Serve bundled sample data from /data/demo for direct browser loading and download
  app.use('/data/demo', express.static(path.join(__dirname, 'data', 'demo')));

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, HOST, () => {
    console.log(`TerraResQ server running at http://localhost:${PORT} (bound on ${HOST}:${PORT})`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[TerraResQ] Error: Port ${PORT} is already in use (EADDRINUSE).\n` +
          `Another process or dev server is using port ${PORT}.\n` +
          `To resolve:\n` +
          `  - On Linux/macOS: lsof -i :${PORT} | grep LISTEN\n` +
          `  - On Windows: netstat -ano | findstr :${PORT}\n` +
          `  - Or choose a different port by setting PORT=<number> (e.g. PORT=3001 npm run dev)`
      );
      process.exit(1);
    } else {
      console.error('[TerraResQ] Server startup error:', err);
      process.exit(1);
    }
  });
}

startServer();
