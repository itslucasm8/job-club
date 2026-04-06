'use client'
import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { useSession } from 'next-auth/react'

type AdminViewContextType = {
  viewAsUser: boolean
  toggleViewAsUser: () => void
}

const AdminViewContext = createContext<AdminViewContextType>({
  viewAsUser: false,
  toggleViewAsUser: () => {},
})

export function AdminViewProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession()
  const isAdmin = (session?.user as any)?.role === 'admin'
  const [viewAsUser, setViewAsUser] = useState(false)

  // Load persisted preference on mount
  useEffect(() => {
    if (isAdmin) {
      const stored = localStorage.getItem('adminViewAsUser')
      if (stored === 'true') setViewAsUser(true)
    }
  }, [isAdmin])

  // Reset if user is not admin
  useEffect(() => {
    if (!isAdmin) setViewAsUser(false)
  }, [isAdmin])

  function toggleViewAsUser() {
    setViewAsUser(prev => {
      const next = !prev
      localStorage.setItem('adminViewAsUser', String(next))
      return next
    })
  }

  return (
    <AdminViewContext.Provider value={{ viewAsUser: isAdmin ? viewAsUser : false, toggleViewAsUser }}>
      {children}
    </AdminViewContext.Provider>
  )
}

export function useAdminView() {
  return useContext(AdminViewContext)
}
