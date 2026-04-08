export default function SettingsLoading() {
  return (
    <div className="px-4 sm:px-5 lg:px-7 py-6 max-w-2xl">
      <div className="h-6 bg-stone-200 rounded w-32 mb-6 animate-pulse" />
      <div className="space-y-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="animate-pulse">
            <div className="h-4 bg-stone-200 rounded w-24 mb-2" />
            <div className="h-10 bg-stone-100 rounded-lg w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}
