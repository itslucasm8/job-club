import JobCardSkeleton from '@/components/JobCardSkeleton'

export default function FeedLoading() {
  return (
    <div className="min-h-screen bg-warm-bg">
      {/* Stats strip skeleton */}
      <div className="px-4 sm:px-5 lg:px-7 pt-4 pb-2">
        <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-[14px] bg-stone-100 border border-stone-200/60 p-3 sm:p-4 animate-pulse">
              <div className="h-7 bg-stone-200 rounded w-10 mb-1" />
              <div className="h-3 bg-stone-200/60 rounded w-16 mt-1" />
            </div>
          ))}
        </div>
      </div>

      {/* Search bar skeleton */}
      <div className="px-4 sm:px-5 lg:px-7 py-3">
        <div className="h-10 bg-white rounded-xl border border-stone-200 animate-pulse" />
        <div className="flex gap-2 mt-2.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-8 bg-stone-100 rounded-[10px] w-14 animate-pulse" />
          ))}
        </div>
      </div>

      {/* Job cards skeleton */}
      <div className="px-4 sm:px-5 lg:px-7 py-4 grid gap-[18px] grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <JobCardSkeleton key={i} />
        ))}
      </div>
    </div>
  )
}
