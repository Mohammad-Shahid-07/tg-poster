import cron from "node-cron";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { config, ensureDirectories, validateConfig, loadLastProcessed } from "./config";
import { runPoster } from "./poster";
import { initBot } from "./bot";
import { validateChannels } from "./scraper";
import { loadPostedContent } from "./content-tracker";
import { isStorageConfigured } from "./storage";
import { loadSession, startAuth, completeAuth, getAuthStatus, isMTProtoConfigured } from "./mtproto-scraper";
import { loadChannels, getChannels, addChannel, removeChannel, getPublicChannels } from "./channel-manager";

const PORT = process.env.PORT || 10000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

// Simple session - just a token in memory
let sessionToken = "";
function generateToken(): string {
    sessionToken = Math.random().toString(36).slice(2) + Date.now().toString(36);
    return sessionToken;
}
function isValidSession(req: IncomingMessage): boolean {
    const cookie = req.headers.cookie || "";
    const token = cookie.match(/session=([^;]+)/)?.[1];
    return token === sessionToken && sessionToken !== "";
}

// Login page
const loginPage = `<!DOCTYPE html>
<html><head><title>Login</title><style>
body{font-family:sans-serif;max-width:400px;margin:100px auto;padding:20px;text-align:center}
input,button{width:100%;padding:12px;margin:10px 0;font-size:16px}
button{background:#0088cc;color:white;border:none;cursor:pointer}
.error{color:red}
</style></head><body>
<h2>🔒 Admin Login</h2>
<form method="POST" action="/login">
  <input type="password" name="password" placeholder="Password" required>
  <button type="submit">Login</button>
</form>
</body></html>`;

// Simple HTML pages
const authPage = `<!DOCTYPE html>
<html><head><title>Telegram Auth</title><style>
body{font-family:sans-serif;max-width:500px;margin:50px auto;padding:20px}
input,button{width:100%;padding:10px;margin:10px 0;font-size:16px}
button{background:#0088cc;color:white;border:none;cursor:pointer}
.status{background:#f0f0f0;padding:10px;border-radius:5px;word-break:break-all}
textarea{width:100%;height:80px;font-family:monospace;font-size:12px}
</style></head><body>
<h2>Telegram Auth</h2>
<div class="status" id="status"></div>
<form id="phoneForm">
  <input type="tel" name="phone" placeholder="+91xxxxxxxxxx" required>
  <button type="submit">Send Code</button>
</form>
<form id="codeForm" style="display:none">
  <input type="text" name="code" placeholder="Enter code" required>
  <button type="submit">Verify</button>
</form>
<div id="sessionDiv" style="display:none">
  <p><strong>Copy this to SESSION_STRING env var:</strong></p>
  <textarea id="sessionStr" readonly></textarea>
  <button onclick="navigator.clipboard.writeText(document.getElementById('sessionStr').value);this.textContent='Copied!'">Copy</button>
</div>
<script>
const status = document.getElementById('status');
const phoneForm = document.getElementById('phoneForm');
const codeForm = document.getElementById('codeForm');
const sessionDiv = document.getElementById('sessionDiv');
const sessionStr = document.getElementById('sessionStr');

fetch('/auth/status').then(r=>r.json()).then(s=>{
  if(!s.configured) status.textContent='API_ID and API_HASH not set';
  else if(s.authenticated) status.textContent='✅ Already authenticated';
  else status.textContent='Enter your phone number';
});

phoneForm.onsubmit=async e=>{
  e.preventDefault();
  status.textContent='Sending code...';
  const r=await fetch('/auth/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:e.target.phone.value})});
  const d=await r.json();
  if(d.success){status.textContent='Code sent! Check Telegram';phoneForm.style.display='none';codeForm.style.display='block';}
  else status.textContent='Error: '+d.error;
};

codeForm.onsubmit=async e=>{
  e.preventDefault();
  status.textContent='Verifying...';
  const r=await fetch('/auth/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:e.target.code.value})});
  const d=await r.json();
  if(d.success){
    status.textContent='✅ Success! Copy the session string below and add to SESSION_STRING env var, then redeploy.';
    codeForm.style.display='none';
    sessionDiv.style.display='block';
    sessionStr.value=d.session;
  }
  else status.textContent='Error: '+d.error;
};
</script></body></html>`;

// Channels management page
const channelsPage = `<!DOCTYPE html>
<html><head><title>Manage Channels</title><style>
body{font-family:sans-serif;max-width:600px;margin:50px auto;padding:20px}
input,button,select{padding:8px;margin:5px;font-size:14px}
button{background:#0088cc;color:white;border:none;cursor:pointer}
.del{background:#cc0000}
.channel{display:flex;justify-content:space-between;align-items:center;padding:10px;margin:5px 0;background:#f5f5f5;border-radius:5px}
.public{border-left:4px solid #4CAF50}
.mtproto{border-left:4px solid #9C27B0}
h3{margin-top:30px}
</style></head><body>
<h2>Manage Source Channels</h2>
<p><a href="/auth">← Auth</a></p>

<h3>Add Channel</h3>
<form id="addForm">
  <input type="text" name="username" placeholder="@channel or t.me/channel link" style="width:250px" required>
  <select name="type">
    <option value="public">Public (web scrape)</option>
    <option value="mtproto">Private (MTProto)</option>
  </select>
  <button type="submit">Add</button>
</form>

<h3>Current Channels</h3>
<div id="list">Loading...</div>

<script>
const list = document.getElementById('list');

async function load() {
  const r = await fetch('/channels/list');
  const channels = await r.json();
  if (channels.length === 0) {
    list.innerHTML = '<p>No channels configured. Add some above!</p>';
    return;
  }
  list.innerHTML = channels.map(c => 
    '<div class="channel ' + c.type + '">' +
    '<span>@' + c.username + ' <small>(' + c.type + ')</small></span>' +
    '<button class="del" onclick="del(\\'' + c.username + '\\')">Remove</button>' +
    '</div>'
  ).join('');
}

document.getElementById('addForm').onsubmit = async e => {
  e.preventDefault();
  const form = e.target;
  const r = await fetch('/channels/add', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({username: form.username.value, type: form.type.value})
  });
  const d = await r.json();
  if (d.success) { form.reset(); load(); }
  else alert('Failed to add (maybe duplicate?)');
};

async function del(username) {
  if (!confirm('Remove @' + username + '?')) return;
  await fetch('/channels/remove', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({username})
  });
  load();
}

load();
</script></body></html>`;

// Parse JSON body
async function parseBody(req: IncomingMessage): Promise<any> {
    return new Promise((resolve) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
            try { resolve(JSON.parse(body)); }
            catch { resolve({}); }
        });
    });
}

// HTTP Server with auth endpoints
createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url || "/";

    // Health check
    if (url === "/" || url === "/health") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("OK - Telegram Poster Bot Running");
        return;
    }

    // Login page
    if (url === "/login" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(loginPage);
        return;
    }

    // Handle login POST
    if (url === "/login" && req.method === "POST") {
        const body = await parseBody(req);
        if (ADMIN_PASSWORD && body.password === ADMIN_PASSWORD) {
            const token = generateToken();
            res.writeHead(302, {
                "Set-Cookie": `session=${token}; Path=/; HttpOnly`,
                "Location": "/channels"
            });
            res.end();
        } else {
            res.writeHead(401, { "Content-Type": "text/html" });
            res.end(loginPage.replace('</h2>', '</h2><p class="error">Wrong password</p>'));
        }
        return;
    }

    // All protected routes require auth if password is set
    if (ADMIN_PASSWORD && !isValidSession(req)) {
        res.writeHead(302, { "Location": "/login" });
        res.end();
        return;
    }

    // Auth page
    if (url === "/auth") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(authPage);
        return;
    }

    // Auth status
    if (url === "/auth/status") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(getAuthStatus()));
        return;
    }

    // Start auth
    if (url === "/auth/start" && req.method === "POST") {
        const body = await parseBody(req);
        const result = await startAuth(body.phone);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
        return;
    }

    // Verify code
    if (url === "/auth/verify" && req.method === "POST") {
        const body = await parseBody(req);
        const result = await completeAuth(body.code);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
        return;
    }

    // Channels page
    if (url === "/channels") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(channelsPage);
        return;
    }

    // Channels API - list
    if (url === "/channels/list") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(getChannels()));
        return;
    }

    // Channels API - add
    if (url === "/channels/add" && req.method === "POST") {
        const body = await parseBody(req);
        const ok = await addChannel(body.username, body.type);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: ok }));
        return;
    }

    // Channels API - remove
    if (url === "/channels/remove" && req.method === "POST") {
        const body = await parseBody(req);
        const ok = await removeChannel(body.username);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: ok }));
        return;
    }

    res.writeHead(404);
    res.end("Not found");
}).listen(PORT, () => {
    console.log(`[Server] Listening on port ${PORT}`);
    console.log(`[Server] Auth: /auth | Channels: /channels`);
});

async function main() {
    console.log("=================================");
    console.log("  Telegram Poster Bot Starting");
    console.log("=================================\n");

    try {
        validateConfig();
    } catch (err: any) {
        console.error("[Error]", err.message);
        console.error("\nRequired: BOT_TOKEN, CHANNEL_ID, SOURCE_CHANNELS");
        process.exit(1);
    }

    ensureDirectories();

    // Load from Supabase
    if (isStorageConfigured()) {
        console.log("[Storage] Loading from Supabase...");
        await loadLastProcessed();
        await loadPostedContent();
        await loadSession();
        await loadChannels();
    }

    // Check MTProto status
    if (isMTProtoConfigured()) {
        const status = getAuthStatus();
        if (status.authenticated) {
            console.log("[MTProto] Session available - can access private channels");
        } else {
            console.log("[MTProto] Not authenticated - visit /auth to login");
        }
    }

    initBot();

    console.log("[Config] Bot Token:", config.botToken.slice(0, 10) + "...");
    console.log("[Config] Channel ID:", config.channelId);
    console.log("[Config] Source Channels:", config.sourceChannels.join(", "));

    const { working, failed } = await validateChannels(config.sourceChannels);

    if (failed.length > 0) {
        console.log("[Warning] Some channels have web preview disabled");
        if (isMTProtoConfigured() && getAuthStatus().authenticated) {
            console.log("[Info] MTProto available - will try these channels via session");
        }
    }

    if (working.length === 0 && !getAuthStatus().authenticated) {
        console.error("[Error] No working channels and no MTProto session!");
        process.exit(1);
    }

    config.sourceChannels.length = 0;
    config.sourceChannels.push(...working);

    console.log("[Startup] Running initial check...");
    await runPoster();

    console.log(`[Scheduler] Cron: ${config.cronSchedule}`);
    cron.schedule(config.cronSchedule, () => runPoster());

    console.log("[Bot] Running. Press Ctrl+C to stop.\n");

    process.on("SIGINT", () => process.exit(0));
    process.on("SIGTERM", () => process.exit(0));
}

main().catch((err) => {
    console.error("[Fatal]", err);
    process.exit(1);
});
