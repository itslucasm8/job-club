export default function JobCardSkeleton() {
  return (
    <div className="rounded-xl border border-stone-200 bg-white overflow-hidden animate-pulse">
      <div className="px-4 py-3.5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-stone-200" />
            <div>
              <div className="h-3.5 bg-stone-200 rounded w-24 mb-1.5" />
              <div className="h-3 bg-stone-100 rounded w-16" />
            </div>
          </div>
          <div className="h-6 bg-stone-100 rounded-full w-12" />
        </div>
      </div>
      <div className="px-4 py-3">
        <div className="h-4 bg-stone-200 rounded w-3/4 mb-2" />
        <div className="h-3 bg-stone-100 rounded w-full mb-1.5" />
        <div className="h-3 bg-stone-100 rounded w-2/3 mb-3" />
        <div className="flex gap-2">
          <div className="h-6 bg-stone-100 rounded-full w-16" />
          <div className="h-6 bg-stone-100 rounded-full w-20" />
          <div className="h-6 bg-stone-100 rounded-full w-14" />
        </div>
      </div>
      <div className="px-4 py-2.5 bg-stone-50/50 border-t border-stone-100">
        <div className="h-3 bg-stone-100 rounded w-24" />
      </div>
    </div>
  )
}
