const $ = (id) => document.getElementById(id)

function showMsg(kind, text) {
  const el = $('msg')
  el.className = `msg ${kind}`
  el.textContent = text
}

async function load() {
  const cfg = await chrome.storage.local.get(['apiUrl', 'secret'])
  $('apiUrl').value = cfg.apiUrl || 'https://thejobclub.com.au'
  $('secret').value = cfg.secret || ''
  refreshStored()
}

async function refreshStored() {
  const cfg = await chrome.storage.local.get(['apiUrl', 'secret'])
  const masked = cfg.secret ? cfg.secret.slice(0, 6) + '…' + cfg.secret.slice(-4) : '(vide)'
  $('stored').textContent = `Stocké → URL: ${cfg.apiUrl || '(vide)'} · secret: ${masked}`
}

async function save() {
  const apiUrl = $('apiUrl').value.trim()
  const secret = $('secret').value.trim()
  if (!apiUrl) { showMsg('err', 'URL manquante'); return }
  if (!secret) { showMsg('err', 'Secret manquant'); return }
  try {
    await chrome.storage.local.set({ apiUrl, secret })
    const verify = await chrome.storage.local.get(['apiUrl', 'secret'])
    if (verify.apiUrl === apiUrl && verify.secret === secret) {
      showMsg('ok', '✓ Enregistré dans le stockage local')
    } else {
      showMsg('err', `Enregistrement incomplet — relue: ${JSON.stringify(verify).slice(0, 200)}`)
    }
    await refreshStored()
  } catch (e) {
    showMsg('err', `Erreur: ${e?.message || e}`)
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('save').addEventListener('click', save)
  load()
})
