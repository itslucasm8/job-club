'use client'
import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { useSession } from 'next-auth/react'
import { translations, type Language, type Translations } from '@/lib/translations'

type LanguageContextType = {
  language: Language
  setLanguage: (lang: Language) => void
  t: Translations
}

const LanguageContext = createContext<LanguageContextType>({
  language: 'fr',
  setLanguage: () => {},
  t: translations.fr,
})

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('fr')
  const { status } = useSession()

  // On mount: load from localStorage immediately (fast), then sync from DB when authenticated
  useEffect(() => {
    const stored = localStorage.getItem('language') as Language | null
    if (stored === 'en' || stored === 'fr') {
      setLanguageState(stored)
      document.documentElement.lang = stored
    }
  }, [])

  useEffect(() => {
    if (status !== 'authenticated') return
    fetch('/api/user/settings')
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.preferredLanguage === 'en' || data?.preferredLanguage === 'fr') {
          setLanguageState(data.preferredLanguage)
          localStorage.setItem('language', data.preferredLanguage)
          document.documentElement.lang = data.preferredLanguage
        }
      })
      .catch(() => {}) // localStorage value is fine as fallback
  }, [status])

  function setLanguage(lang: Language) {
    setLanguageState(lang)
    localStorage.setItem('language', lang)
    document.documentElement.lang = lang
    // Persist to DB if authenticated (fire-and-forget)
    if (status === 'authenticated') {
      fetch('/api/user/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredLanguage: lang }),
      }).catch(() => {})
    }
  }

  return (
    <LanguageContext.Provider value={{ language, t: translations[language], setLanguage }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useTranslation() {
  const ctx = useContext(LanguageContext)
  return ctx
}
