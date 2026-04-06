import './globals.css'
import { Inter } from 'next/font/google'
import PostHogProvider from '@/components/PostHogProvider'
import { LanguageProvider } from '@/components/LanguageContext'

// Force all pages to render dynamically (no stale pre-rendered HTML)
export const dynamic = 'force-dynamic'

const inter = Inter({ subsets: ['latin'] })

export const metadata = {
  title: 'Job Club — Jobs for Backpackers in Australia',
  description: 'Find your next job in Australia. Hundreds of backpacker-friendly job listings updated weekly.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className={`${inter.className} bg-stone-100 text-stone-900 min-h-screen`}>
        <LanguageProvider>
          <PostHogProvider>{children}</PostHogProvider>
        </LanguageProvider>
      </body>
    </html>
  )
}
