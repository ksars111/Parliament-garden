import express from "express";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MARKERS_FILE = path.join(__dirname, "markers.json");

async function ensureMarkersFile() {
  try {
    await fs.access(MARKERS_FILE);
  } catch {
    await fs.writeFile(MARKERS_FILE, JSON.stringify([]));
  }
}

async function startServer() {
  await ensureMarkersFile();
  const app = express();
  app.use(express.json());
  const PORT = 3000;

  // Markers API
  app.get("/api/markers", async (req, res) => {
    try {
      const data = await fs.readFile(MARKERS_FILE, "utf-8");
      res.json(JSON.parse(data));
    } catch (error) {
      res.status(500).json({ error: "Failed to read markers" });
    }
  });

  app.post("/api/markers", async (req, res) => {
    try {
      const marker = req.body;
      const data = await fs.readFile(MARKERS_FILE, "utf-8");
      let markers = JSON.parse(data);
      
      const index = markers.findIndex((m: any) => m.id === marker.id);
      if (index !== -1) {
        markers[index] = { ...markers[index], ...marker };
      } else {
        markers.push(marker);
      }
      
      await fs.writeFile(MARKERS_FILE, JSON.stringify(markers, null, 2));
      res.json(marker);
    } catch (error) {
      res.status(500).json({ error: "Failed to save marker" });
    }
  });

  app.delete("/api/markers/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const data = await fs.readFile(MARKERS_FILE, "utf-8");
      let markers = JSON.parse(data);
      markers = markers.filter((m: any) => m.id !== id);
      await fs.writeFile(MARKERS_FILE, JSON.stringify(markers, null, 2));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete marker" });
    }
  });

  // Google Satellite Tile Proxy
  app.get("/api/tiles/:z/:y/:x", async (req, res) => {
    const { z, y, x } = req.params;
    // Use mt1 as primary, but could rotate
    const url = `https://mt1.google.com/vt/lyrs=s&x=${x}&y=${y}&z=${z}`;

    try {
      const response = await axios({
        method: 'get',
        url: url,
        responseType: 'stream',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });

      // Set cache headers for better performance
      res.setHeader('Cache-Control', 'public, max-age=86400'); // 24 hours
      res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
      
      response.data.pipe(res);
    } catch (error) {
      console.error(`Error fetching tile ${z}/${y}/${x}:`, error instanceof Error ? error.message : String(error));
      res.status(500).send('Error fetching tile');
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
