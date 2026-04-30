// Options page logic — load + save backend URL and token, test connection.

const DEFAULT_BACKEND = 'https://thejobclub.com.au'

const $ = (id) => document.getElementById(id)

async function load() {
  const cfg = await chrome.storage.sync.get(['backendUrl', 'extensionToken'])
  $('backend').value = cfg.backendUrl || DEFAULT_BACKEND
  $('token').value = cfg.extensionToken || ''
}

function showStatus(message, kind = 'ok') {
  $('status').textContent = message
  $('status').className = `status ${kind}`
}

$('save').addEventListener('click', async () => {
  const backend = $('backend').value.trim() || DEFAULT_BACKEND
  const token = $('token').value.trim()
  if (!token || token.length < 32) {
    showStatus('Token invalide (≥ 32 caractères attendus).', 'err')
    return
  }
  await chrome.storage.sync.set({ backendUrl: backend, extensionToken: token })
  showStatus('✓ Sauvegardé.', 'ok')
})

$('test').addEventListener('click', async () => {
  const backend = $('backend').value.trim() || DEFAULT_BACKEND
  const token = $('token').value.trim()
  if (!token) {
    showStatus('Token manquant.', 'err')
    return
  }
  try {
    showStatus('Test en cours…', 'ok')
    const res = await fetch(`${backend}/api/extension/groups`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      showStatus(`✗ HTTP ${res.status}: ${text.slice(0, 100)}`, 'err')
      return
    }
    const d = await res.json()
    showStatus(`✓ OK — ${(d.groups || []).length} groupes configurés.`, 'ok')
  } catch (e) {
    showStatus(`✗ Erreur réseau: ${e?.message || e}`, 'err')
  }
})

load()
