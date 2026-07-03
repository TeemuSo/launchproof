#!/usr/bin/env node
// LaunchProof: viewer/serve.js
//
// Tiny static server, Node's built-in http only. Serves the dashboard and
// exposes recorded runs (written by run.mjs into runs/<runId>/) as JSON +
// static files. Localhost only, no auth, no CORS handling needed.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const RUNS_DIR = path.join(ROOT, 'runs');
const VIEWER_DIR = __dirname;
const PORT = process.env.PORT || 4321;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.zip': 'application/zip',
};

function contentTypeFor(filePath) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

// Serves a file, honoring HTTP Range requests (206 Partial Content).
//
// This is NOT optional for video: the dashboard's <video> tag uses
// preload="metadata", so Chromium deliberately does not download the whole
// file up front -- it fetches only enough to read the container's metadata,
// then issues a fresh ranged request (`Range: bytes=<offset>-`) whenever
// the user (or the chapter track) seeks to an unbuffered position. A server
// that ignores that header and always sends the full 200 response from
// byte 0 breaks seeking outright: the browser can't reconcile the reply
// with the range it asked for, so the seek silently fails and playback
// falls back to wherever it already was. Screenshots/JSON/etc. never send
// a Range header, so this degrades to a normal full-file 200 for them.
function sendFile(req, res, filePath) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      send404(res);
      return;
    }

    const contentType = contentTypeFor(filePath);
    const range = req.headers.range;
    const rangeMatch = range && /^bytes=(\d*)-(\d*)$/.exec(range);

    if (rangeMatch) {
      const [, startStr, endStr] = rangeMatch;
      let start = startStr ? parseInt(startStr, 10) : 0;
      let end = endStr ? parseInt(endStr, 10) : stat.size - 1;

      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        res.end();
        return;
      }
      end = Math.min(end, stat.size - 1);

      res.writeHead(206, {
        'Content-Type': contentType,
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function send404(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

// Returns every run's result.json, keeping only the newest (by startedAt)
// per distinct test name.
function listLatestRunsPerTest() {
  if (!fs.existsSync(RUNS_DIR)) return [];
  const entries = fs.readdirSync(RUNS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory());
  const latestByTest = new Map();

  for (const entry of entries) {
    const resultPath = path.join(RUNS_DIR, entry.name, 'result.json');
    if (!fs.existsSync(resultPath)) continue;
    let result;
    try {
      result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    } catch {
      continue;
    }
    const existing = latestByTest.get(result.test);
    if (!existing || new Date(result.startedAt) > new Date(existing.startedAt)) {
      latestByTest.set(result.test, result);
    }
  }

  return Array.from(latestByTest.values())
    .map((r) => ({
      runId: r.runId,
      test: r.test,
      title: r.title,
      verdict: r.verdict,
      startedAt: r.startedAt,
      durationMs: r.durationMs,
    }))
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
}

function getRunById(runId) {
  const resultPath = path.join(RUNS_DIR, runId, 'result.json');
  if (!fs.existsSync(resultPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  } catch {
    return null;
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/' || pathname === '/index.html') {
    sendFile(req, res, path.join(VIEWER_DIR, 'index.html'));
    return;
  }

  if (pathname === '/api/runs') {
    sendJson(res, 200, listLatestRunsPerTest());
    return;
  }

  const runMatch = pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (runMatch) {
    const run = getRunById(runMatch[1]);
    if (!run) {
      sendJson(res, 404, { error: 'run not found' });
      return;
    }
    sendJson(res, 200, run);
    return;
  }

  // Static artifacts recorded under runs/<id>/... (video.webm, shots/*.png,
  // trace.zip).
  const artifactMatch = pathname.match(/^\/runs\/([^/]+)\/(.+)$/);
  if (artifactMatch) {
    const [, runId, rest] = artifactMatch;
    const filePath = path.join(RUNS_DIR, runId, rest);
    // Protect against path traversal outside the run's own directory.
    const runDir = path.join(RUNS_DIR, runId);
    if (!filePath.startsWith(runDir + path.sep)) {
      send404(res);
      return;
    }
    sendFile(req, res, filePath);
    return;
  }

  // Any other static asset the viewer page references (css/js).
  const viewerFilePath = path.join(VIEWER_DIR, pathname.replace(/^\//, ''));
  if (viewerFilePath.startsWith(VIEWER_DIR + path.sep) && fs.existsSync(viewerFilePath)) {
    sendFile(req, res, viewerFilePath);
    return;
  }

  send404(res);
});

server.listen(PORT, () => {
  console.log(`LaunchProof viewer running at http://localhost:${PORT}`);
});
