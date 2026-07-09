// LaunchProof acceptance fixture: a real, login-gated web app.
//
// Deliberately requires auth so the captured storageState is MEANINGFUL:
// logging in sets both a session COOKIE (sid) and a localStorage token
// (lp_demo_token). A run against this app therefore proves that shot.ts
// captures real auth state, not an empty {cookies:[],origins:[]} shell.
//
// No dependencies — plain node:http. Sessions live in memory.
//
// Routes:
//   GET  /            login form (redirects to /dashboard if already signed in)
//   POST /login       validates (password must be "secret"), sets sid cookie
//   GET  /dashboard   protected; greets the user by name, seeds localStorage
//   POST /logout      clears the session
//
// Usage: node fixture-app.mjs [port]   (default 4599)

import http from 'node:http';

const PORT = Number(process.argv[2] || process.env.FIXTURE_PORT || 4599);
const sessions = new Map(); // sid -> username

// A tiny deterministic token generator (no Math.random — must be reproducible
// enough for logs, unique enough for a session key within one process run).
let sidCounter = 0;
function newSid() {
  sidCounter += 1;
  return `sid-${sidCounter}-${process.pid}`;
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('='));
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

function html(body) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LaunchProof Demo</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:12vh auto;padding:0 1rem}
label{display:block;margin:.75rem 0 .25rem}input{font-size:1rem;padding:.4rem;width:100%}
button{margin-top:1rem;font-size:1rem;padding:.5rem 1rem;cursor:pointer}
.err{color:#b00}</style></head><body>${body}</body></html>`;
}

function loginPage(error) {
  return html(`
    <h1>Sign in</h1>
    ${error ? `<p class="err" role="alert">${error}</p>` : ''}
    <form method="POST" action="/login">
      <label for="username">Username</label>
      <input id="username" name="username" autocomplete="username" required>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button type="submit">Sign in</button>
    </form>
    <p>Hint: any username, password <code>secret</code>.</p>
  `);
}

function dashboardPage(username) {
  // The inline script seeds localStorage, so storageState() captures a real
  // origins[].localStorage entry — not just the cookie.
  return html(`
    <h1>Dashboard</h1>
    <p>Welcome, <strong data-testid="current-user">${username}</strong>!</p>
    <p>You are signed in. This page is only reachable with a valid session.</p>
    <form method="POST" action="/logout"><button type="submit">Sign out</button></form>
    <script>localStorage.setItem('lp_demo_token', 'tok-for-${username}');</script>
  `);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const cookies = parseCookies(req);
  const username = cookies.sid ? sessions.get(cookies.sid) : null;

  if (req.method === 'GET' && url.pathname === '/') {
    if (username) {
      res.writeHead(302, { Location: '/dashboard' });
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(loginPage(null));
  }

  if (req.method === 'POST' && url.pathname === '/login') {
    const body = new URLSearchParams(await readBody(req));
    const user = (body.get('username') || '').trim();
    const pass = body.get('password') || '';
    if (!user || pass !== 'secret') {
      res.writeHead(401, { 'content-type': 'text/html' });
      return res.end(loginPage('Invalid credentials — password is "secret".'));
    }
    const sid = newSid();
    sessions.set(sid, user);
    res.writeHead(302, {
      // HttpOnly omitted on purpose: storageState captures document.cookie-less
      // cookies fine either way (it reads the context's cookie jar), but keeping
      // it plain keeps the fixture easy to reason about.
      'Set-Cookie': `sid=${sid}; Path=/; SameSite=Lax`,
      Location: '/dashboard',
    });
    return res.end();
  }

  if (req.method === 'GET' && url.pathname === '/dashboard') {
    if (!username) {
      res.writeHead(302, { Location: '/' });
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(dashboardPage(username));
  }

  if (req.method === 'POST' && url.pathname === '/logout') {
    if (cookies.sid) sessions.delete(cookies.sid);
    res.writeHead(302, { 'Set-Cookie': 'sid=; Path=/; Max-Age=0', Location: '/' });
    return res.end();
  }

  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`fixture-app listening on http://localhost:${PORT}`);
});
