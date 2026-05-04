'use client'
import { useRouter } from 'next/navigation'
import { useTranslation } from '@/components/LanguageContext'
import ManualPublishForm from '@/components/ManualPublishForm'

export default function PublishJobPage() {
  const router = useRouter()
  const { t } = useTranslation()

  return (
    <div className="px-4 sm:px-5 lg:px-7 py-5 pb-24 lg:pb-10 max-w-3xl">
      <h1 className="text-xl sm:text-2xl font-extrabold text-stone-900 mb-1">{t.admin.publishTitle}</h1>
      <p className="text-sm text-stone-500 mb-6">{t.admin.publishSubtitle}</p>
      <ManualPublishForm onPublished={() => router.push('/feed')} />
    </div>
  )
}
