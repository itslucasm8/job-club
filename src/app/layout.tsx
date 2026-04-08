import type { Viewport } from 'next'
import './globals.css'
import { Inter } from 'next/font/google'
import PostHogProvider from '@/components/PostHogProvider'
import { LanguageProvider } from '@/components/LanguageContext'
import CookieConsent from '@/components/CookieConsent'

// Force all pages to render dynamically (no stale pre-rendered HTML)
export const dynamic = 'force-dynamic'

const inter = Inter({ subsets: ['latin'] })

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export const metadata = {
  title: 'Job Club — Jobs for Backpackers in Australia',
  description: 'Find your next job in Australia. Hundreds of backpacker-friendly job listings updated weekly.',
  manifest: '/manifest.json',
  icons: {
    icon: '/favicon.svg',
    apple: '/favicon.svg',
  },
  metadataBase: new URL('https://thejobclub.com.au'),
  openGraph: {
    title: 'Job Club — Jobs for Backpackers in Australia',
    description: 'Find your next job in Australia. 900+ curated listings across all states. Farm work, hospitality, construction & more.',
    url: 'https://thejobclub.com.au',
    siteName: 'Job Club',
    locale: 'en_AU',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Job Club — Jobs for Backpackers in Australia',
    description: 'Find your next job in Australia. 900+ curated listings across all states.',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className={`${inter.className} bg-stone-100 text-stone-900 min-h-screen`}>
        <LanguageProvider>
          <PostHogProvider>
            {children}
            <CookieConsent />
          </PostHogProvider>
        </LanguageProvider>
      </body>
    </html>
  )
}
