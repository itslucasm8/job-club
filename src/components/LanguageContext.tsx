'use client'
import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react'
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
  const didSyncRef = useRef(false)

  // On mount: load from localStorage (instant), then try syncing from DB
  useEffect(() => {
    const stored = localStorage.getItem('language') as Language | null
    if (stored === 'en' || stored === 'fr') {
      setLanguageState(stored)
      document.documentElement.lang = stored
    }

    // Try fetching user's DB preference — returns 401 if not logged in, which we ignore
    if (!didSyncRef.current) {
      didSyncRef.current = true
      fetch('/api/user/settings')
        .then((res) => res.ok ? res.json() : null)
        .then((data) => {
          if (data?.preferredLanguage === 'en' || data?.preferredLanguage === 'fr') {
            setLanguageState(data.preferredLanguage)
            localStorage.setItem('language', data.preferredLanguage)
            document.documentElement.lang = data.preferredLanguage
          }
        })
        .catch(() => {})
    }
  }, [])

  function setLanguage(lang: Language) {
    setLanguageState(lang)
    localStorage.setItem('language', lang)
    document.documentElement.lang = lang
    // Persist to DB (fire-and-forget, silently fails if not logged in)
    fetch('/api/user/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferredLanguage: lang }),
    }).catch(() => {})
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
