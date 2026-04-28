// Job Club extension popup
// Reads the visible text of the active tab and posts it to the backend.

const $ = (id) => document.getElementById(id)

async function loadConfig() {
  const cfg = await chrome.storage.sync.get(['apiUrl', 'secret'])
  return { apiUrl: cfg.apiUrl || '', secret: cfg.secret || '' }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab
}

async function extractPageText(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const clone = document.body.cloneNode(true)
      clone.querySelectorAll('script, style, noscript').forEach((n) => n.remove())
      return {
        title: document.title || '',
        url: location.href,
        text: clone.innerText.replace(/\n{3,}/g, '\n\n').trim().slice(0, 100_000),
      }
    },
  })
  return result
}

function showMsg(kind, text) {
  const el = $('msg')
  el.className = `msg ${kind}`
  el.textContent = text
}

async function init() {
  const cfg = await loadConfig()
  if (!cfg.apiUrl || !cfg.secret) {
    $('needs-setup').style.display = 'block'
    $('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage())
    return
  }
  $('main').style.display = 'block'

  const tab = await getActiveTab()
  if (!tab?.url || !/^https?:/.test(tab.url)) {
    showMsg('warn', "Cette page n'est pas une URL HTTP — rien à envoyer.")
    $('send').disabled = true
    return
  }

  let captured
  try {
    captured = await extractPageText(tab.id)
  } catch (e) {
    showMsg('err', `Impossible de lire la page: ${e?.message || e}`)
    $('send').disabled = true
    return
  }

  $('url').textContent = captured.url
  $('char-count').textContent = `${captured.text.length} caractères`
  try {
    $('domain').textContent = new URL(captured.url).hostname
  } catch {
    $('domain').textContent = '—'
  }

  if (captured.text.length < 200) {
    showMsg('warn', "Très peu de texte sur la page (<200 caractères). L'extraction risque d'échouer.")
  }

  $('send').addEventListener('click', async () => {
    $('send').disabled = true
    showMsg('warn', 'Envoi en cours… (8-15s pour l\'extraction IA)')
    try {
      const res = await fetch(`${cfg.apiUrl.replace(/\/$/, '')}/api/extension/import-candidate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cfg.secret}`,
        },
        body: JSON.stringify({
          url: captured.url,
          page_text: captured.text,
          page_title: captured.title,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        if (data.status === 'duplicate') {
          showMsg('warn', `Doublon: ${data.message || 'déjà importée'}`)
        } else {
          showMsg('ok', `✓ Importée: ${data.raw?.title || '(candidat sans titre)'}`)
        }
      } else if (res.status === 401) {
        showMsg('err', 'Secret invalide. Vérifie les options.')
      } else {
        showMsg('err', `Erreur ${res.status}: ${data.error || 'voir logs'}`)
      }
    } catch (e) {
      showMsg('err', `Erreur réseau: ${e?.message || e}`)
    } finally {
      $('send').disabled = false
    }
  })

  $('reopen-options').addEventListener('click', (ev) => {
    ev.preventDefault()
    chrome.runtime.openOptionsPage()
  })
}

init()
