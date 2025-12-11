/**
 * Auth page - MTProto session generation with 2FA support
 */
export function getAuthPage(): string {
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Telegram Auth</title><style>
body{font-family:sans-serif;max-width:500px;margin:50px auto;padding:20px}
input,button{width:100%;padding:10px;margin:10px 0;font-size:16px}
button{background:#0088cc;color:white;border:none;cursor:pointer}
.status{background:#f0f0f0;padding:10px;border-radius:5px;word-break:break-all}
textarea{width:100%;height:80px;font-family:monospace;font-size:12px}
</style></head><body>
<h2>Telegram Auth</h2>
<p><a href="/">← Home</a></p>
<div class="status" id="status"></div>
<form id="phoneForm">
  <input type="tel" name="phone" placeholder="+91xxxxxxxxxx" required>
  <button type="submit">Send Code</button>
</form>
<form id="codeForm" style="display:none">
  <input type="text" name="code" placeholder="Enter code" required>
  <button type="submit">Verify</button>
</form>
<form id="twoFAForm" style="display:none">
  <input type="password" name="password" placeholder="2FA Password" required>
  <button type="submit">Submit Password</button>
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
const twoFAForm = document.getElementById('twoFAForm');
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
    showSession(d.session);
  } else if(d.needs2FA){
    status.textContent='2FA Required - Enter your Telegram password';
    codeForm.style.display='none';
    twoFAForm.style.display='block';
  } else {
    status.textContent='Error: '+d.error;
  }
};

twoFAForm.onsubmit=async e=>{
  e.preventDefault();
  status.textContent='Verifying password...';
  const r=await fetch('/auth/2fa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:e.target.password.value})});
  const d=await r.json();
  if(d.success){
    showSession(d.session);
  } else {
    status.textContent='Error: '+d.error;
  }
};

function showSession(session){
  status.textContent='✅ Success! Copy the session string below and add to SESSION_STRING env var, then redeploy.';
  phoneForm.style.display='none';
  codeForm.style.display='none';
  twoFAForm.style.display='none';
  sessionDiv.style.display='block';
  sessionStr.value=session;
}
</script></body></html>`;
}
