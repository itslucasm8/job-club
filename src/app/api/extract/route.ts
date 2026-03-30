import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { extractSchema, getFirstValidationError } from '@/lib/validation'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  const body = await req.json()

  // Validate with Zod
  const result = extractSchema.safeParse(body)
  if (!result.success) {
    return NextResponse.json({ error: getFirstValidationError(result.error) }, { status: 400 })
  }

  const { url } = result.data

  try {
    // Create AbortController for 10-second timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    const html = await res.text()

    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i)
    const descMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i)

    const bodyText = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 2000)

    return NextResponse.json({
      title: h1Match?.[1]?.trim() || titleMatch?.[1]?.trim() || '',
      description: descMatch?.[1] || bodyText.substring(0, 500),
      sourceUrl: url,
    })
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      return NextResponse.json({ error: 'Délai d\'attente dépassé' }, { status: 500 })
    }
    return NextResponse.json({ error: "Impossible de lire cette URL" }, { status: 500 })
  }
}
