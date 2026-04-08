'use client'

import Link from 'next/link'
import { useTranslation } from '@/components/LanguageContext'

export default function PrivacyPage() {
  const { t } = useTranslation()

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <Link href="/feed" className="text-sm text-purple-600 hover:underline mb-6 inline-block">
        &larr; {t.legal.backToFeed}
      </Link>

      <h1 className="text-2xl font-extrabold text-stone-900 mb-2">{t.legal.privacyTitle}</h1>
      <p className="text-sm text-stone-400 mb-8">{t.legal.lastUpdated}: 2026-04-08</p>

      <div className="space-y-6 text-sm text-stone-700 leading-relaxed">
        <p>{t.legal.privacyIntro}</p>

        <Section title={t.legal.dataCollectedTitle}>
          <ul className="list-disc pl-5 space-y-1">
            {t.legal.dataCollectedItems.map((item: string, i: number) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </Section>

        <Section title={t.legal.paymentDataTitle}>
          <p>{t.legal.paymentDataText}</p>
        </Section>

        <Section title={t.legal.analyticsTitle}>
          <p>{t.legal.analyticsText}</p>
        </Section>

        <Section title={t.legal.emailTitle}>
          <p>{t.legal.emailText}</p>
        </Section>

        <Section title={t.legal.dataSharingTitle}>
          <p>{t.legal.dataSharingText}</p>
        </Section>

        <Section title={t.legal.yourRightsTitle}>
          <p>{t.legal.yourRightsText}</p>
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
