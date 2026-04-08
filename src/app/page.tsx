'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useTranslation } from '@/components/LanguageContext'

export default function LandingPage() {
  const { t, language, setLanguage } = useTranslation()
  const [plan, setPlan] = useState<'monthly' | 'yearly'>('monthly')

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* ═══════ Left side ═══════ */}
      <div className="relative flex-[1.1] flex flex-col justify-center px-6 py-12 sm:px-10 lg:px-12 lg:py-0 overflow-hidden"
        style={{ background: '#1e1145' }}>
        {/* Dot grid */}
        <div className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(167,139,250,0.12) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />
        {/* Corner brackets */}
        <div className="absolute top-7 left-7 w-6 h-6 border-t-2 border-l-2 hidden lg:block" style={{ borderColor: 'rgba(245,158,11,0.2)' }} />
        <div className="absolute bottom-7 right-7 w-6 h-6 border-b-2 border-r-2 hidden lg:block" style={{ borderColor: 'rgba(245,158,11,0.2)' }} />

        {/* Content */}
        <div className="relative z-[1] max-w-md">
          {/* Eyebrow */}
          <div className="flex items-center gap-2 mb-5">
            <span className="w-6 h-0.5 rounded-sm bg-amber-500" />
            <span className="text-[11px] font-semibold text-amber-500 uppercase tracking-[1.5px]">Job Club</span>
          </div>

          <h1 className="text-[clamp(28px,5vw,40px)] font-bold text-purple-50 leading-[1.15] tracking-tight mb-4">
            {t.landing.heroTitle1}<br />{t.landing.heroTitle2}
          </h1>

          <p className="text-[15px] text-purple-300 leading-relaxed max-w-xs sm:max-w-[340px] mb-8">
            {t.landing.tagline}
          </p>

          {/* Stats */}
          <div className="flex gap-6 sm:gap-8">
            <div>
              <div className="text-[28px] font-bold text-white">900+</div>
              <div className="text-[11px] text-purple-400 uppercase tracking-wider mt-0.5">{t.landing.statsJobs}</div>
            </div>
            <div>
              <div className="text-[28px] font-bold text-white">8</div>
              <div className="text-[11px] text-purple-400 uppercase tracking-wider mt-0.5">{t.landing.statsStates}</div>
            </div>
            <div>
              <div className="text-[28px] font-bold text-white">9</div>
              <div className="text-[11px] text-purple-400 uppercase tracking-wider mt-0.5">{t.landing.statsCategories}</div>
            </div>
          </div>
        </div>

        {/* Language toggle — mobile only */}
        <button
          onClick={() => setLanguage(language === 'fr' ? 'en' : 'fr')}
          className="absolute top-4 right-4 lg:hidden px-3 py-1.5 rounded-full text-xs font-bold bg-white/10 text-purple-200 hover:bg-white/20 transition"
        >
          {t.language.label}
        </button>
      </div>

      {/* ═══════ Right side ═══════ */}
      <div className="flex-[0.9] flex flex-col justify-center items-center px-6 py-10 sm:px-10 lg:px-10 lg:py-0"
        style={{ background: '#faf9f7' }}>

        {/* Language toggle — desktop only */}
        <button
          onClick={() => setLanguage(language === 'fr' ? 'en' : 'fr')}
          className="absolute top-4 right-4 hidden lg:block px-3 py-1.5 rounded-full text-xs font-bold bg-stone-200/60 text-stone-500 hover:bg-stone-200 transition"
        >
          {t.language.label}
        </button>

        <div className="w-full max-w-[340px]">
          <div className="text-base font-semibold text-stone-600 mb-4">
            {t.landing.choosePlan}
          </div>

          {/* Monthly option */}
          <button
            onClick={() => setPlan('monthly')}
            className={`w-full flex items-center gap-3.5 p-4 rounded-2xl mb-2.5 border-2 transition-all text-left ${
              plan === 'monthly'
                ? 'border-brand-purple bg-purple-50/60'
                : 'border-stone-200 bg-white hover:border-stone-300'
            }`}
          >
            <div className={`w-[22px] h-[22px] rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all ${
              plan === 'monthly' ? 'border-brand-purple' : 'border-stone-300'
            }`}>
              {plan === 'monthly' && <div className="w-3 h-3 rounded-full bg-brand-purple" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-stone-800">{t.landing.monthly}</div>
              <div className="text-[11px] text-stone-400 mt-0.5">
                {t.landing.billedMonthly}
              </div>
            </div>
            <div className="flex items-baseline gap-1 flex-shrink-0">
              <span className="text-xl font-bold text-stone-900 tracking-tight">$39.99</span>
              <span className="text-xs text-stone-400">{t.landing.perMonth}</span>
            </div>
          </button>

          {/* Yearly option */}
          <button
            onClick={() => setPlan('yearly')}
            className={`w-full flex items-center gap-3.5 p-4 rounded-2xl mb-4 border-2 transition-all text-left ${
              plan === 'yearly'
                ? 'border-brand-purple bg-purple-50/60'
                : 'border-stone-200 bg-white hover:border-stone-300'
            }`}
          >
            <div className={`w-[22px] h-[22px] rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all ${
              plan === 'yearly' ? 'border-brand-purple' : 'border-stone-300'
            }`}>
              {plan === 'yearly' && <div className="w-3 h-3 rounded-full bg-brand-purple" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-stone-800">{t.landing.yearly}</span>
                <span className="text-[9px] font-bold bg-amber-500 text-amber-900 px-1.5 py-0.5 rounded-full uppercase tracking-wide">-17%</span>
              </div>
              <div className="text-[11px] text-green-600 font-semibold mt-0.5">
                {t.landing.yearSavings}
              </div>
            </div>
            <div className="flex items-baseline gap-1 flex-shrink-0">
              <span className="text-xl font-bold text-stone-900 tracking-tight">$400</span>
              <span className="text-xs text-stone-400">{t.landing.perYear}</span>
            </div>
          </button>

          {/* CTA */}
          <Link
            href="/register"
            className="block w-full text-center py-4 rounded-2xl bg-brand-purple hover:bg-brand-purple-dark text-white text-[15px] font-semibold transition-all hover:-translate-y-0.5"
            style={{ boxShadow: '0 8px 20px rgba(107,33,168,0.3)' }}
          >
            {t.landing.subscribe}
          </Link>

          {/* Trust */}
          <p className="text-center text-[11px] text-stone-400 mt-4">
            {t.landing.securePayment}
          </p>

          {/* Sign in */}
          <p className="text-center text-[13px] text-stone-500 mt-3">
            {t.landing.alreadyMember}{' '}
            <Link href="/login" className="text-brand-purple font-medium hover:underline">
              {t.landing.signIn}
            </Link>
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-4 text-[11px] text-stone-400 lg:text-purple-400/60">
        <Link href="/privacy">{t.legal.privacyTitle}</Link>
        <span>·</span>
        <Link href="/terms">{t.legal.termsTitle}</Link>
      </div>
    </div>
  )
}
