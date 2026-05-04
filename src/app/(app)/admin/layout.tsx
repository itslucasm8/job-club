import RunStatusBanner from '@/components/RunStatusBanner'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <RunStatusBanner />
    </>
  )
}
