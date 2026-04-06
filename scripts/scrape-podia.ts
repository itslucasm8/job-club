/**
 * Podia Community Job Scraper
 *
 * Opens a browser for you to log in manually (to bypass Cloudflare),
 * then automatically scrapes all job posts from every state section.
 *
 * Usage:
 *   npx tsx scripts/scrape-podia.ts
 *
 * Steps:
 *   1. Browser opens → you log in to Podia manually
 *   2. Navigate to ANY state section (e.g., QLD) so you're in the community
 *   3. Come back to the terminal and press Enter
 *   4. Script finds all state sections, visits each one,
 *      clicks "lire plus" to expand posts, and scrapes everything
 *
 * Output:
 *   scripts/podia-raw-posts.json — all posts with state, title, description, date
 */

import { chromium } from 'playwright-core'
import { writeFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { createInterface } from 'readline'

const PODIA_URL = 'https://jobclub.mylittlefrance.com.au'
const OUTPUT_PATH = resolve(__dirname, 'podia-raw-posts.json')

// Edge with the user's existing profile (already logged in, has cookies)
const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const EDGE_PROFILE = 'C:\\Users\\lucas\\AppData\\Local\\Microsoft\\Edge\\User Data'

// Map Podia section names to our state codes
const STATE_MAP: Record<string, string> = {
  'queensland': 'QLD',
  'qld': 'QLD',
  'new south wales': 'NSW',
  'nsw': 'NSW',
  'victoria': 'VIC',
  'vic': 'VIC',
  'south australia': 'SA',
  'western australia': 'WA',
  'wa': 'WA',
  'tasmania': 'TAS',
  'tas': 'TAS',
  'northern territory': 'NT',
  'nt': 'NT',
  'australian capital territory': 'ACT',
  'act': 'ACT',
}

function resolveState(sectionName: string): string {
  const lower = sectionName.toLowerCase()
  // Try exact match first
  for (const [key, code] of Object.entries(STATE_MAP)) {
    if (lower.includes(key)) return code
  }
  // Try abbreviation in parentheses like "Queensland (QLD)"
  const match = sectionName.match(/\(([A-Z]{2,3})\)/)
  if (match && ['QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'NT', 'ACT'].includes(match[1])) {
    return match[1]
  }
  return 'UNKNOWN'
}

interface RawPost {
  title: string
  description: string
  date: string
  state: string
  sectionName: string
  index: number
}

function waitForEnter(prompt: string): Promise<void> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(prompt, () => {
      rl.close()
      resolve()
    })
  })
}

async function main() {
  console.log(`\nLaunching Edge with your existing profile (already logged in)...`)
  console.log('NOTE: Close all Edge windows first! The script needs exclusive access to your profile.\n')

  const context = await chromium.launchPersistentContext(EDGE_PROFILE, {
    executablePath: EDGE_PATH,
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'], // Look less like a bot
  })
  const page = await context.newPage()

  // Navigate to community home — should be already logged in via cookies
  console.log('Opening Podia community...')
  await page.goto(`${PODIA_URL}/community/home`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(3000)

  console.log(`Current URL: ${page.url()}`)
  await page.screenshot({ path: resolve(__dirname, 'podia-start.png') })
  console.log('Screenshot saved: scripts/podia-start.png')

  // Check if we're actually on the community page or got redirected to login
  const currentUrl = page.url()
  if (currentUrl.includes('login') || currentUrl.includes('sign_in')) {
    console.log('\n⚠ Looks like you got redirected to login.')
    console.log('  Log in manually in the browser window, then press Enter.')
    await waitForEnter('\nPress ENTER when you\'re on the community page... ')
  } else {
    console.log('✓ Community page loaded!')
    await waitForEnter('\nConfirm the page looks right, then press ENTER to start scraping... ')
  }

  console.log(`\nCurrent URL: ${page.url()}`)
  await page.screenshot({ path: resolve(__dirname, 'podia-start.png') })

  // Step 2: Find all state section links from the sidebar
  console.log('\nLooking for state sections in the sidebar...')

  const sectionLinks = await page.evaluate(() => {
    const links: { text: string; href: string }[] = []
    // Look in the sidebar for rubrique/section links
    const allLinks = document.querySelectorAll('a')
    for (const link of allLinks) {
      const text = link.textContent?.trim() || ''
      const href = link.getAttribute('href') || ''
      // State sections contain state names or abbreviations
      const stateKeywords = [
        'queensland', 'qld', 'new south wales', 'nsw', 'victoria', 'vic',
        'south australia', 'western australia', 'wa', 'tasmania', 'tas',
        'northern territory', 'australian capital territory', 'act',
      ]
      if (stateKeywords.some(kw => text.toLowerCase().includes(kw))) {
        links.push({ text, href })
      }
    }
    return links
  })

  if (sectionLinks.length === 0) {
    console.log('Could not auto-detect state section links.')
    console.log('Dumping all sidebar links for inspection...')

    const allLinks = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a')).map(a => ({
        text: a.textContent?.trim() || '',
        href: a.getAttribute('href') || '',
      })).filter(l => l.text.length > 0 && l.text.length < 100)
    })
    allLinks.forEach(l => console.log(`  "${l.text}" → ${l.href}`))

    const html = await page.content()
    writeFileSync(resolve(__dirname, 'podia-page-dump.html'), html)
    console.log('\nPage HTML saved to scripts/podia-page-dump.html')
    console.log('Please share the output above so I can adjust the script.')
    await context.close()
    return
  }

  // Deduplicate section links
  const uniqueSections = new Map<string, { text: string; href: string }>()
  for (const link of sectionLinks) {
    const state = resolveState(link.text)
    if (state !== 'UNKNOWN' && !uniqueSections.has(state)) {
      uniqueSections.set(state, link)
    }
  }

  console.log(`Found ${uniqueSections.size} state sections:`)
  for (const [state, link] of uniqueSections) {
    console.log(`  ${state}: "${link.text}" → ${link.href}`)
  }

  // Step 3: Scrape each state section
  const allPosts: RawPost[] = []

  for (const [stateCode, link] of uniqueSections) {
    console.log(`\n========================================`)
    console.log(`  Scraping: ${link.text} (${stateCode})`)
    console.log(`========================================`)

    // Click the sidebar link instead of page.goto() to avoid re-triggering Cloudflare
    try {
      const sidebarLink = page.locator(`a:has-text("${link.text}")`).first()
      await sidebarLink.scrollIntoViewIfNeeded()
      await sidebarLink.click()
    } catch {
      // Fallback: navigate directly if the link isn't clickable
      const fullUrl = link.href.startsWith('http') ? link.href : `${PODIA_URL}${link.href}`
      await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
    }
    await page.waitForTimeout(3000)

    // Scroll to bottom to load all posts
    let previousHeight = 0
    let noNewContentCount = 0

    for (let scroll = 0; scroll < 100; scroll++) {
      const currentHeight = await page.evaluate(() => document.body.scrollHeight)
      if (currentHeight === previousHeight) {
        noNewContentCount++
        if (noNewContentCount >= 3) break
      } else {
        noNewContentCount = 0
      }
      previousHeight = currentHeight
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await page.waitForTimeout(2000)

      // Log progress every 5 scrolls
      if ((scroll + 1) % 5 === 0) {
        console.log(`  Scrolling... (scroll ${scroll + 1})`)
      }
    }

    console.log('  Reached bottom. Expanding truncated posts...')

    // Click all "lire plus" / "Read more" buttons to expand truncated posts
    let expandedCount = 0
    while (true) {
      const buttons = page.locator('button:has-text("lire plus"), button:has-text("Lire plus"), button:has-text("Read more"), a:has-text("lire plus"), a:has-text("Lire plus"), [class*="read-more"], [class*="ReadMore"], [class*="truncat"] button, [class*="expand"] button')
      const count = await buttons.count()
      if (count === 0) break

      // Click the first visible one
      try {
        const btn = buttons.first()
        await btn.scrollIntoViewIfNeeded()
        await btn.click()
        expandedCount++
        await page.waitForTimeout(500)
      } catch {
        // Button might have disappeared after clicking, that's fine
        break
      }

      // Safety limit
      if (expandedCount > 200) break
    }
    console.log(`  Expanded ${expandedCount} truncated posts.`)

    // Scroll back to top so we can collect everything
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(1000)

    // Now scroll down again slowly and collect all posts
    // This time we're just reading, not waiting for new loads
    const posts = await page.evaluate(() => {
      const results: { title: string; description: string; date: string }[] = []

      // Podia community posts: each post is in a card/container
      // From the screenshot, each post has:
      // - Author line: "MLF Jobs · Créateur"
      // - Topic tag: "# Australian Capital Territory (ACT)"
      // - Date: "25 mars"
      // - Title: bold text (like an h3 or strong)
      // - Body: paragraph text with job description
      // - Footer: reaction button, "...", "0 commentaires"

      // Strategy: find post containers by looking for the pattern
      // of title + description blocks

      // Try various Podia post container selectors
      const containerSelectors = [
        'article',
        '[class*="post-card"]', '[class*="PostCard"]', '[class*="post_card"]',
        '[class*="feed-post"]', '[class*="FeedPost"]',
        '[class*="topic-post"]', '[class*="TopicPost"]',
        '[class*="community-post"]', '[class*="CommunityPost"]',
        '[data-post-id]', '[data-testid*="post"]',
      ]

      let containers: HTMLElement[] = []
      for (const sel of containerSelectors) {
        const found = document.querySelectorAll<HTMLElement>(sel)
        if (found.length > 0) {
          containers = Array.from(found)
          break
        }
      }

      if (containers.length > 0) {
        // Found structured containers
        for (const container of containers) {
          const text = container.innerText?.trim() || ''
          if (text.length < 30) continue

          // Try to extract title (usually the first bold/heading element)
          const titleEl = container.querySelector('h1, h2, h3, h4, strong, b, [class*="title"], [class*="Title"]')
          const title = titleEl?.textContent?.trim() || ''

          // Try to extract date
          const dateEl = container.querySelector('time, [datetime], [class*="date"], [class*="time"], [class*="ago"]')
          let date = dateEl?.getAttribute('datetime') || dateEl?.textContent?.trim() || ''

          // Get the full text minus the title
          let description = text
          if (title && description.includes(title)) {
            // Remove everything before and including the title to get just the body
            const titleIdx = description.indexOf(title)
            description = description.substring(titleIdx + title.length).trim()
          }

          // Clean up: remove the footer stuff (reactions, comments, etc.)
          description = description
            .replace(/\d+ commentaires?/gi, '')
            .replace(/Ajouter un commentaire/gi, '')
            .replace(/MLF Jobs.*?Créateur/gi, '')
            .replace(/#\s*[\w\s()]+\n/g, '') // Remove topic tags
            .replace(/\.\.\./g, '')
            .trim()

          if (title || description.length > 30) {
            results.push({ title, description, date })
          }
        }
      } else {
        // Fallback: parse the entire page text by looking for patterns
        // Each post starts with "MLF Jobs" author line
        const fullText = document.body.innerText || ''
        const postBlocks = fullText.split(/MLF Jobs\s*.*?Créateur/)

        for (const block of postBlocks) {
          const trimmed = block.trim()
          if (trimmed.length < 30) continue

          // First meaningful line is often the date + topic
          const lines = trimmed.split('\n').map(l => l.trim()).filter(l => l.length > 0)

          // Find the title (usually a short bold-looking line after the date)
          let title = ''
          let date = ''
          let descStart = 0

          for (let i = 0; i < Math.min(lines.length, 5); i++) {
            const line = lines[i]
            // Date patterns: "25 mars", "3 avr.", "12 février"
            if (/^\d{1,2}\s+(jan|fév|mar|avr|mai|juin|juil|aoû|sep|oct|nov|déc)/i.test(line) ||
                /^#\s/.test(line)) {
              if (/^\d/.test(line)) date = line
              continue
            }
            // Title: short line (under ~100 chars) that's not a date or tag
            if (!title && line.length > 3 && line.length < 150 && !line.startsWith('#')) {
              title = line
              descStart = i + 1
              break
            }
          }

          const description = lines.slice(descStart).join('\n')
            .replace(/\d+ commentaires?/gi, '')
            .replace(/Ajouter un commentaire/gi, '')
            .replace(/\.\.\./g, '')
            .trim()

          if (title || description.length > 30) {
            results.push({ title, description, date })
          }
        }
      }

      return results
    })

    console.log(`  Found ${posts.length} posts in ${stateCode}`)

    for (const post of posts) {
      allPosts.push({
        title: post.title,
        description: post.description,
        date: post.date,
        state: stateCode,
        sectionName: link.text,
        index: allPosts.length,
      })
    }
  }

  // Step 4: Save results
  console.log(`\n========================================`)
  console.log(`  DONE: Collected ${allPosts.length} posts total`)
  console.log(`========================================`)

  // Print summary by state
  const stateCounts: Record<string, number> = {}
  for (const post of allPosts) {
    stateCounts[post.state] = (stateCounts[post.state] || 0) + 1
  }
  console.log('\nPosts per state:')
  for (const [state, count] of Object.entries(stateCounts).sort()) {
    console.log(`  ${state}: ${count}`)
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(allPosts, null, 2))
  console.log(`\nSaved to: ${OUTPUT_PATH}`)

  await page.screenshot({ path: resolve(__dirname, 'podia-final.png'), fullPage: false })

  await context.close()
  console.log('\nBrowser closed.')
  console.log('Come back to Claude Code — I\'ll parse the results into CSV for import.')
}

main().catch(e => {
  console.error('Scraping failed:', e.message)
  process.exit(1)
})
