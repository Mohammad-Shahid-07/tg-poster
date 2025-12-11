/**
 * Login page - Admin password authentication
 */
export function getLoginPage(error?: string): string {
    const errorHtml = error ? `<p class="error">${error}</p>` : "";
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Login</title><style>
body{font-family:sans-serif;max-width:400px;margin:100px auto;padding:20px;text-align:center}
input,button{width:100%;padding:12px;margin:10px 0;font-size:16px}
button{background:#0088cc;color:white;border:none;cursor:pointer}
.error{color:red}
</style></head><body>
<h2>🔒 Admin Login</h2>
${errorHtml}
<form method="POST" action="/login">
  <input type="password" name="password" placeholder="Password" required>
  <button type="submit">Login</button>
</form>
</body></html>`;
}
