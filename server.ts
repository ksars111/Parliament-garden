import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Load Firebase config for server-side use
  const configPath = path.resolve(__dirname, 'firebase-applet-config.json');
  let firebaseApp;
  let db;

  if (fs.existsSync(configPath)) {
    const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    firebaseApp = initializeApp(firebaseConfig);
    db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
  }

  // API Routes
  app.get('/api/garden', async (req, res) => {
    if (!db) {
      return res.status(500).json({ error: 'Firebase not configured on server' });
    }

    try {
      // Vercel Edge Caching: Cache for 1 hour (3600), stale-while-revalidate for 24 hours
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
      
      const docRef = doc(db, 'garden', 'data');
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        res.json(docSnap.data());
      } else {
        res.json({ markers: [] });
      }
    } catch (error) {
      console.error('Server-side Firestore error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isQuotaError = errorMessage.includes('Quota limit exceeded') || errorMessage.includes('Quota exceeded');
      
      if (isQuotaError) {
        return res.status(503).json({ 
          error: 'Quota Exceeded', 
          message: 'The free daily read limit for the garden map has been reached. Please check back tomorrow.' 
        });
      }
      
      res.status(500).json({ error: 'Failed to fetch garden data' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
