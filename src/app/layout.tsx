import './globals.css'
import { Inter } from 'next/font/google'

const inter = Inter({ subsets: ['latin'] })

export const metadata = {
  title: 'Job Club — MLF Jobs Australia',
  description: 'Trouve ton job en Australie. Des centaines d\'offres pour backpackers chaque semaine.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className={`${inter.className} bg-stone-100 text-stone-900 min-h-screen`}>{children}</body>
    </html>
  )
}
