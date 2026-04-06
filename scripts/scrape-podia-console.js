/**
 * Podia Job Scraper — Browser Console Version
 *
 * HOW TO USE:
 * 1. Go to a state section (e.g. QLD: /community/topics/86353)
 * 2. Press F12 → Console tab
 * 3. Paste this ENTIRE script and press Enter
 * 4. Wait for it to finish (it scrolls and clicks "lire plus" automatically)
 * 5. Navigate to the NEXT state section and paste+run again
 * 6. Repeat for all states
 * 7. After the last state, it automatically downloads the JSON file
 *
 * State URLs:
 *   VIC: https://jobclub.mylittlefrance.com.au/community/topics/86360
 *   ACT: https://jobclub.mylittlefrance.com.au/community/topics/86361
 *   SA:  https://jobclub.mylittlefrance.com.au/community/topics/86362
 *   TAS: https://jobclub.mylittlefrance.com.au/community/topics/86363
 *   NT:  https://jobclub.mylittlefrance.com.au/community/topics/86365
 */

(async function scrapePodiaJobs() {
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // Detect which state we're on from the URL
  const STATE_URLS = {
    '86360': 'VIC',
    '86361': 'ACT',
    '86362': 'SA',
    '86363': 'TAS',
    '86365': 'NT',
  };
  const ALL_STATES = ['VIC', 'ACT', 'SA', 'TAS', 'NT'];

  const urlMatch = window.location.href.match(/topics\/(\d+)/);
  const topicId = urlMatch ? urlMatch[1] : null;
  const currentState = topicId ? STATE_URLS[topicId] : null;

  if (!currentState) {
    console.error('[SCRAPER] Cannot detect state from URL. Make sure you are on one of these pages:');
    console.log('  QLD: https://jobclub.mylittlefrance.com.au/community/topics/86353');
    console.log('  NSW: https://jobclub.mylittlefrance.com.au/community/topics/86359');
    console.log('  WA:  https://jobclub.mylittlefrance.com.au/community/topics/86364');
    return;
  }

  console.log(`%c[SCRAPER] Scraping ${currentState}...`, 'color: orange; font-weight: bold; font-size: 14px');

  // Step 1: Scroll to bottom to load all posts
  console.log('  Scrolling to load all posts...');
  let previousHeight = 0;
  let noNewContent = 0;

  for (let i = 0; i < 100; i++) {
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(2000);

    const currentHeight = document.body.scrollHeight;
    if (currentHeight === previousHeight) {
      noNewContent++;
      if (noNewContent >= 3) {
        console.log(`  Reached bottom after ${i + 1} scrolls`);
        break;
      }
    } else {
      noNewContent = 0;
    }
    previousHeight = currentHeight;
    if ((i + 1) % 5 === 0) console.log(`  Scrolling... (${i + 1})`);
  }

  // Step 2: Click all "lire plus" buttons to expand truncated posts
  console.log('  Expanding truncated posts...');
  let expanded = 0;
  for (let attempt = 0; attempt < 100; attempt++) {
    const buttons = Array.from(document.querySelectorAll('button, a, span')).filter(el => {
      const t = el.textContent.trim().toLowerCase();
      return t === 'lire plus' || t === 'read more' || t.endsWith('lire plus');
    });
    if (buttons.length === 0) break;
    for (const btn of buttons) {
      try {
        btn.scrollIntoView({ behavior: 'instant', block: 'center' });
        btn.click();
        expanded++;
        await sleep(300);
      } catch(e) {}
    }
    await sleep(500);
  }
  if (expanded > 0) console.log(`  Expanded ${expanded} posts`);

  // Step 3: Extract posts
  console.log('  Extracting post data...');
  const bodyText = document.body.innerText;
  const blocks = bodyText.split(/MLF Jobs\s*[^\n]*Créateur/);

  const posts = [];
  for (const block of blocks) {
    const trimmed = block.trim();
    if (trimmed.length < 30) continue;

    const lines = trimmed.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    let title = '';
    let date = '';
    let descStart = 0;

    for (let i = 0; i < Math.min(lines.length, 8); i++) {
      const line = lines[i];

      // Skip topic tags like "# Queensland (QLD)"
      if (line.startsWith('#')) continue;

      // Skip UI elements
      if (line === 'Créateur') continue;
      if (/^\d+\s*commentaires?$/i.test(line)) continue;
      if (line === 'Ajouter un commentaire') continue;

      // Date: "25 mars", "3 avr.", "12 février"
      if (/^\d{1,2}\s+(jan|fév|mar|avr|mai|juin|juil|aoû|sep|oct|nov|déc)/i.test(line)) {
        date = line;
        continue;
      }

      // First real content line = title
      if (!title && line.length > 2 && line.length < 200) {
        title = line;
        descStart = i + 1;
        break;
      }
    }

    let description = lines.slice(descStart).join('\n')
      .replace(/\d+\s*commentaires?/gi, '')
      .replace(/Ajouter un commentaire/gi, '')
      .replace(/lire plus/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // Remove trailing UI junk (reaction buttons, etc.)
    description = description.replace(/\s*\.{3}\s*$/, '').trim();

    if ((title && title.length > 2) || description.length > 30) {
      posts.push({ title, description, date, state: currentState });
    }
  }

  console.log(`%c  Found ${posts.length} posts in ${currentState}!`, 'color: green; font-weight: bold');

  // Step 4: Save to localStorage (accumulate across runs)
  const storageKey = 'podia_scraper_results';
  let allPosts = [];
  try {
    const existing = localStorage.getItem(storageKey);
    if (existing) allPosts = JSON.parse(existing);
  } catch(e) {}

  // Remove any previous posts for this state (in case of re-run)
  allPosts = allPosts.filter(p => p.state !== currentState);
  // Add new posts
  allPosts.push(...posts);
  localStorage.setItem(storageKey, JSON.stringify(allPosts));

  // Summary
  const done = {};
  for (const p of allPosts) done[p.state] = (done[p.state] || 0) + 1;
  const doneStates = Object.keys(done);
  const remaining = ALL_STATES.filter(s => !doneStates.includes(s));

  console.log(`\n%c[SCRAPER] Progress:`, 'color: purple; font-weight: bold');
  console.table(done);
  console.log(`Total: ${allPosts.length} posts`);

  if (remaining.length > 0) {
    console.log(`\n%c[SCRAPER] Next: go to these sections and paste this script again:`, 'color: orange; font-weight: bold');
    const urlMap = { 'VIC': '86360', 'ACT': '86361', 'SA': '86362', 'TAS': '86363', 'NT': '86365' };
    for (const s of remaining) {
      console.log(`  ${s}: https://jobclub.mylittlefrance.com.au/community/topics/${urlMap[s]}`);
    }
  } else {
    // All done! Download the file
    console.log(`\n%c[SCRAPER] ALL STATES DONE! Downloading JSON...`, 'color: green; font-size: 16px; font-weight: bold');

    const blob = new Blob([JSON.stringify(allPosts, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'podia-raw-posts.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log('%c[SCRAPER] Done! Move the downloaded file to your job-club/scripts/ folder.', 'color: purple; font-weight: bold');
  }
})();
