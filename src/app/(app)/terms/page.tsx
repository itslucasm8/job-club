'use client'

import Link from 'next/link'
import { useTranslation } from '@/components/LanguageContext'

export default function TermsPage() {
  const { t } = useTranslation()

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <Link href="/feed" className="text-sm text-purple-600 hover:underline mb-6 inline-block">
        &larr; {t.legal.backToFeed}
      </Link>

      <h1 className="text-2xl font-extrabold text-stone-900 mb-2">{t.legal.termsTitle}</h1>
      <p className="text-sm text-stone-400 mb-8">{t.legal.lastUpdated}: 2026-04-08</p>

      <div className="space-y-6 text-sm text-stone-700 leading-relaxed">
        <p>{t.legal.termsIntro}</p>

        <Section title={t.legal.serviceTitle}>
          <p>{t.legal.serviceText}</p>
        </Section>

        <Section title={t.legal.subscriptionTitle}>
          <ul className="list-disc pl-5 space-y-1">
            {t.legal.subscriptionItems.map((item: string, i: number) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </Section>

        <Section title={t.legal.accountTitle}>
          <p>{t.legal.accountText}</p>
        </Section>

        <Section title={t.legal.contentTitle}>
          <p>{t.legal.contentText}</p>
        </Section>

        <Section title={t.legal.limitationTitle}>
          <p>{t.legal.limitationText}</p>
        </Section>

        <Section title={t.legal.changesTitle}>
          <p>{t.legal.changesText}</p>
        </Section>

        <Section title={t.legal.contactTitle}>
          <p>{t.legal.contactText}</p>
          <p className="font-medium mt-1">contact@thejobclub.com.au</p>
        </Section>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-base font-bold text-stone-900 mb-2">{title}</h2>
      {children}
    </div>
  )
}
