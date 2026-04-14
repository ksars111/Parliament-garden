import React, { useState, useEffect } from 'react';
import { Github, RefreshCw, CheckCircle, AlertCircle, LogOut, Settings } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export const GitHubSync: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [repo, setRepo] = useState(localStorage.getItem('github_repo') || '');
  const [status, setStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    checkAuthStatus();

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'GITHUB_AUTH_SUCCESS') {
        setIsAuthenticated(true);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const checkAuthStatus = async () => {
    try {
      const res = await fetch('/api/auth/github/status');
      const data = await res.json();
      setIsAuthenticated(data.isAuthenticated);
    } catch (err) {
      console.error('Failed to check auth status', err);
    }
  };

  const handleConnect = async () => {
    try {
      const res = await fetch('/api/auth/github');
      const { url } = await res.json();
      window.open(url, 'github_auth', 'width=600,height=700');
    } catch (err) {
      console.error('Failed to get auth URL', err);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/github/logout', { method: 'POST' });
    setIsAuthenticated(false);
  };

  const handleSync = async () => {
    if (!repo) {
      setErrorMessage('Please enter a repository (owner/repo)');
      setStatus('error');
      return;
    }

    setStatus('syncing');
    setErrorMessage('');
    localStorage.setItem('github_repo', repo);

    try {
      const res = await fetch('/api/github/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo }),
      });

      const data = await res.json();
      if (data.success) {
        setStatus('success');
        setTimeout(() => setStatus('idle'), 3000);
      } else {
        throw new Error(data.details || data.error);
      }
    } catch (err: any) {
      setStatus('error');
      setErrorMessage(err.message);
    }
  };

  if (!isAuthenticated) {
    return (
      <button
        onClick={handleConnect}
        className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-full text-xs font-medium transition-all border border-white/10 shadow-lg"
      >
        <Github size={14} />
        Connect GitHub
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <AnimatePresence mode="wait">
          {status === 'syncing' ? (
            <motion.div
              key="syncing"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="px-3 py-1.5 bg-emerald-500/20 border border-emerald-500/30 rounded-full flex items-center gap-2"
            >
              <RefreshCw size={12} className="text-emerald-500 animate-spin" />
              <span className="text-[10px] font-mono text-emerald-500 uppercase tracking-wider">Syncing...</span>
            </motion.div>
          ) : status === 'success' ? (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="px-3 py-1.5 bg-emerald-500 text-white rounded-full flex items-center gap-2 shadow-lg shadow-emerald-500/20"
            >
              <CheckCircle size={12} />
              <span className="text-[10px] font-mono uppercase tracking-wider">Synced</span>
            </motion.div>
          ) : status === 'error' ? (
            <motion.div
              key="error"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="px-3 py-1.5 bg-red-500 text-white rounded-full flex items-center gap-2 shadow-lg shadow-red-500/20 max-w-[200px]"
            >
              <AlertCircle size={12} className="shrink-0" />
              <span className="text-[10px] font-mono uppercase tracking-wider truncate">{errorMessage || 'Error'}</span>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div className="flex items-center bg-zinc-900/80 backdrop-blur-md border border-white/10 rounded-full p-1 shadow-xl">
          <button
            onClick={handleSync}
            disabled={status === 'syncing'}
            className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 text-white rounded-full text-[10px] font-mono uppercase tracking-wider transition-all disabled:opacity-50"
          >
            <Github size={12} />
            Sync to GitHub
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-1.5 hover:bg-white/5 text-white/60 hover:text-white rounded-full transition-all"
          >
            <Settings size={12} />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            className="bg-zinc-900 border border-white/10 p-4 rounded-2xl shadow-2xl w-64"
          >
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-mono text-white/40 uppercase tracking-wider block mb-1">Repository (owner/repo)</label>
                <input
                  type="text"
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                  placeholder="karlsarsfield/garden-data"
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500/50 transition-all font-mono"
                />
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-white/5">
                <span className="text-[10px] font-mono text-white/40 uppercase tracking-wider">Connected</span>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-1 text-[10px] font-mono text-red-400 hover:text-red-300 uppercase tracking-wider transition-all"
                >
                  <LogOut size={10} />
                  Logout
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
