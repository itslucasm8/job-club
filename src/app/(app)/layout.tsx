import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import SessionProvider from '@/components/SessionProvider'
import { ToastProvider } from '@/components/Toast'
import { AdminViewProvider } from '@/components/AdminViewContext'
import Sidebar from '@/components/Sidebar'
import TopBar from '@/components/TopBar'
import BottomTabs from '@/components/BottomTabs'
import AdminViewBanner from '@/components/AdminViewBanner'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)

  return (
    <SessionProvider session={session}>
      <AdminViewProvider>
        <ToastProvider>
          <div className="flex min-h-screen">
            <Sidebar />
            <div className="flex-1 min-w-0 flex flex-col">
              <TopBar />
              <main className="flex-1">{children}</main>
            </div>
          </div>
          <BottomTabs />
          <AdminViewBanner />
        </ToastProvider>
      </AdminViewProvider>
    </SessionProvider>
  )
}
