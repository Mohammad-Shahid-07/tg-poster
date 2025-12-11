/**
 * Channels page - Source channel management
 */
export function getChannelsPage(): string {
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Manage Channels</title><style>
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
<p><a href="/">← Home</a> | <a href="/auth">Auth</a></p>

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
  const btn = form.querySelector('button');
  btn.textContent = 'Verifying...';
  btn.disabled = true;
  
  const r = await fetch('/channels/add', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({username: form.username.value, type: form.type.value})
  });
  const d = await r.json();
  btn.textContent = 'Add';
  btn.disabled = false;
  
  if (d.success) {
    form.reset();
    load();
  } else if (d.verified === false) {
    alert('Channel verification failed:\\n' + d.reason);
  } else {
    alert('Failed to add (maybe duplicate?)');
  }
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
}
