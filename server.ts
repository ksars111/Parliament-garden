import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import cors from "cors";
import { fileURLToPath } from "url";
import axios from "axios";
import { Octokit } from "octokit";
import cookieParser from "cookie-parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(cookieParser());

  const DATA_FILE = path.join(__dirname, "src", "data", "markers.json");

  // Ensure data directory exists
  const dataDir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Initialize data file if it doesn't exist
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
  }

  // API Routes
  app.get("/api/markers", (req, res) => {
    try {
      const data = fs.readFileSync(DATA_FILE, "utf-8");
      res.json(JSON.parse(data));
    } catch (error) {
      res.status(500).json({ error: "Failed to read markers" });
    }
  });

  app.post("/api/markers", (req, res) => {
    try {
      const markers = req.body;
      fs.writeFileSync(DATA_FILE, JSON.stringify(markers, null, 2));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to save markers" });
    }
  });

  // --- GitHub OAuth ---
  app.get("/api/auth/github", (req, res) => {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
    const redirectUri = `${appUrl}/api/auth/github/callback`;

    if (!clientId) {
      return res.status(500).json({ error: "GITHUB_CLIENT_ID not configured" });
    }

    const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=repo`;
    res.json({ url: githubAuthUrl });
  });

  app.get("/api/auth/github/callback", async (req, res) => {
    const { code } = req.query;
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;

    if (!code) return res.status(400).send("No code provided");

    try {
      const response = await axios.post(
        "https://github.com/login/oauth/access_token",
        {
          client_id: clientId,
          client_secret: clientSecret,
          code,
        },
        { headers: { Accept: "application/json" } }
      );

      const { access_token } = response.data;
      if (!access_token) throw new Error("No access token received");

      // Set cookie with token
      res.cookie("github_token", access_token, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      res.send(`
        <html>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'GITHUB_AUTH_SUCCESS' }, '*');
                window.close();
              } else {
                window.location.href = '/';
              }
            </script>
            <p>Authentication successful. You can close this window.</p>
          </body>
        </html>
      `);
    } catch (error) {
      console.error("GitHub Auth Error:", error);
      res.status(500).send("Authentication failed");
    }
  });

  app.get("/api/auth/github/status", (req, res) => {
    const token = req.cookies.github_token;
    res.json({ isAuthenticated: !!token });
  });

  app.post("/api/auth/github/logout", (req, res) => {
    res.clearCookie("github_token");
    res.json({ success: true });
  });

  // --- GitHub Sync ---
  app.post("/api/github/sync", async (req, res) => {
    const token = req.cookies.github_token;
    if (!token) return res.status(401).json({ error: "Not authenticated with GitHub" });

    const { repo, branch = "main", message = "Sync garden markers" } = req.body;
    if (!repo) return res.status(400).json({ error: "Repository name required (owner/repo)" });

    try {
      const octokit = new Octokit({ auth: token });
      const [owner, repoName] = repo.split("/");

      // 1. Get current markers data
      const markersData = fs.readFileSync(DATA_FILE, "utf-8");
      
      // 2. Get the latest commit on the branch
      const { data: refData } = await octokit.rest.git.getRef({
        owner,
        repo: repoName,
        ref: `heads/${branch}`,
      });
      const latestCommitSha = refData.object.sha;

      // 3. Get the tree of the latest commit
      const { data: commitData } = await octokit.rest.git.getCommit({
        owner,
        repo: repoName,
        commit_sha: latestCommitSha,
      });
      const baseTreeSha = commitData.tree.sha;

      // 4. Create a new tree with the updated markers.json
      const { data: newTree } = await octokit.rest.git.createTree({
        owner,
        repo: repoName,
        base_tree: baseTreeSha,
        tree: [
          {
            path: "src/data/markers.json",
            mode: "100644",
            type: "blob",
            content: markersData,
          },
        ],
      });

      // 5. Create a new commit
      const { data: newCommit } = await octokit.rest.git.createCommit({
        owner,
        repo: repoName,
        message,
        tree: newTree.sha,
        parents: [latestCommitSha],
      });

      // 6. Update the branch reference
      await octokit.rest.git.updateRef({
        owner,
        repo: repoName,
        ref: `heads/${branch}`,
        sha: newCommit.sha,
      });

      res.json({ success: true, commit: newCommit.sha });
    } catch (error: any) {
      console.error("GitHub Sync Error:", error);
      res.status(500).json({ 
        error: "Failed to sync to GitHub", 
        details: error.message,
        status: error.status
      });
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
