import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import SessionProvider from '@/components/SessionProvider'
import Sidebar from '@/components/Sidebar'
import TopBar from '@/components/TopBar'
import BottomTabs from '@/components/BottomTabs'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)

  return (
    <SessionProvider session={session}>
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex-1 min-w-0 flex flex-col">
          <TopBar />
          <main className="flex-1">{children}</main>
        </div>
      </div>
      <BottomTabs />
    </SessionProvider>
  )
}
