export default function NotificationsLoading() {
  return (
    <div className="px-4 sm:px-5 lg:px-7 py-6">
      <div className="h-6 bg-stone-200 rounded w-36 mb-6 animate-pulse" />
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-stone-200 p-4 animate-pulse">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-stone-200 flex-shrink-0" />
              <div className="flex-1">
                <div className="h-4 bg-stone-200 rounded w-3/4 mb-2" />
                <div className="h-3 bg-stone-100 rounded w-1/2" />
              </div>
              <div className="h-3 bg-stone-100 rounded w-12" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
