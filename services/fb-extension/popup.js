// Popup logic — shows run status, lets admin trigger a manual run.

const $ = (id) => document.getElementById(id)

function timeAgo(iso) {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "à l'instant"
  if (mins < 60) return `${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} h`
  return `${Math.floor(hours / 24)} j`
}

async function refresh() {
  // Token + backend
  const cfg = await chrome.storage.sync.get(['extensionToken', 'backendUrl'])
  $('token-status').textContent = cfg.extensionToken ? '🔒 configuré' : '⚠ manquant'
  $('token-status').className = 'value ' + (cfg.extensionToken ? 'ok' : 'err')

  // FB cookie test
  let fbOk = false
  try {
    const cookie = await chrome.cookies.get({ url: 'https://www.facebook.com', name: 'c_user' }).catch(() => null)
    fbOk = !!cookie
  } catch {/* no cookies permission — fall back to host check */ fbOk = true}
  $('fb-status').textContent = fbOk ? '✓ oui' : '✗ pas connecté'
  $('fb-status').className = 'value ' + (fbOk ? 'ok' : 'err')

  // Status from background
  chrome.runtime.sendMessage({ type: 'getStatus' }, (resp) => {
    if (chrome.runtime.lastError || !resp) return
    const lr = resp.lastRun
    $('last-run').textContent = lr ? timeAgo(lr.completedAt || lr.startedAt) : '—'
    $('last-posts').textContent = lr ? `${lr.totalPosts} (${lr.totalErrors} erreurs)` : '—'
    if (resp.running) {
      $('run-btn').disabled = true
      $('run-btn').textContent = '⌛ Run en cours…'
    }
    if (lr?.error) {
      $('status-detail').style.display = 'block'
      $('status-detail').textContent = lr.error
    }
  })
}

$('run-btn').addEventListener('click', async () => {
  $('run-btn').disabled = true
  $('run-btn').textContent = '⌛ Run en cours…'
  $('status-detail').style.display = 'block'
  $('status-detail').textContent = 'Démarrage… Le popup peut se fermer pendant le run; la status reviendra à jour à la prochaine ouverture.'
  chrome.runtime.sendMessage({ type: 'runNow', triggeredBy: 'manual' }, (resp) => {
    if (chrome.runtime.lastError) {
      $('status-detail').textContent = 'Erreur: ' + chrome.runtime.lastError.message
      $('run-btn').disabled = false
      $('run-btn').textContent = '▶ Run now'
      return
    }
    if (resp?.ok) {
      const s = resp.summary
      $('status-detail').textContent = `Terminé. ${s.totalPosts} posts capturés, ${s.totalErrors} erreurs.`
    } else {
      $('status-detail').textContent = 'Erreur: ' + (resp?.error || 'inconnue')
    }
    $('run-btn').disabled = false
    $('run-btn').textContent = '▶ Run now'
    refresh()
  })
})

$('open-options').addEventListener('click', (e) => {
  e.preventDefault()
  chrome.runtime.openOptionsPage()
})

$('open-admin').addEventListener('click', async (e) => {
  e.preventDefault()
  const cfg = await chrome.storage.sync.get(['backendUrl'])
  chrome.tabs.create({ url: (cfg.backendUrl || 'https://thejobclub.com.au') + '/admin/extensions' })
})

refresh()
