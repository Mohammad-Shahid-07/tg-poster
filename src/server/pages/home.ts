/**
 * Home page - Navigation dashboard
 */
export function getHomePage(): string {
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>TG Poster Bot</title><style>
body{font-family:sans-serif;max-width:400px;margin:50px auto;padding:20px;text-align:center}
a{display:block;padding:15px;margin:10px;background:#0088cc;color:white;text-decoration:none;border-radius:5px}
a:hover{background:#006699}
.status{background:#4CAF50;color:white;padding:10px;border-radius:5px;margin-bottom:20px}
</style></head><body>
<h2>🤖 TG Poster Bot</h2>
<div class="status">✅ Running</div>
<a href="/channels">📺 Manage Channels</a>
<a href="/auth">🔐 MTProto Auth</a>
<a href="/login">🔑 Admin Login</a>
</body></html>`;
}
