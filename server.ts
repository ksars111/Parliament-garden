import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import cors from "cors";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;

  // Initialize SQLite Database
  const db = new Database("garden.db");
  db.pragma("journal_mode = WAL");

  // Create markers table
  db.exec(`
    CREATE TABLE IF NOT EXISTS markers (
      id TEXT PRIMARY KEY,
      uid TEXT,
      latitude REAL,
      longitude REAL,
      name TEXT,
      description TEXT,
      imageUrl TEXT,
      createdAt INTEGER,
      type TEXT
    )
  `);

  app.use(cors());
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ limit: "10mb", extended: true }));

  // API Routes
  app.get("/api/markers", (req, res) => {
    try {
      const markers = db.prepare("SELECT * FROM markers").all();
      res.json(markers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch markers" });
    }
  });

  app.post("/api/markers", (req, res) => {
    const marker = req.body;
    try {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO markers (id, uid, latitude, longitude, name, description, imageUrl, createdAt, type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        marker.id,
        marker.uid,
        marker.latitude,
        marker.longitude,
        marker.name,
        marker.description,
        marker.imageUrl,
        marker.createdAt,
        marker.type
      );
      
      // Broadcast to all clients
      io.emit("marker_updated", marker);
      res.json({ status: "ok", marker });
    } catch (error) {
      res.status(500).json({ error: "Failed to save marker" });
    }
  });

  app.delete("/api/markers/:id", (req, res) => {
    const { id } = req.params;
    try {
      db.prepare("DELETE FROM markers WHERE id = ?").run(id);
      
      // Broadcast to all clients
      io.emit("marker_deleted", id);
      res.json({ status: "ok" });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete marker" });
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
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Socket.io connection
  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);
    
    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);
    });
  });

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(console.error);
