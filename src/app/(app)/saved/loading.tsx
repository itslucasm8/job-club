import JobCardSkeleton from '@/components/JobCardSkeleton'

export default function SavedLoading() {
  return (
    <div className="px-4 sm:px-5 lg:px-7 py-6">
      <div className="h-6 bg-stone-200 rounded w-40 mb-6 animate-pulse" />
      <div className="grid gap-[18px] grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <JobCardSkeleton key={i} />
        ))}
      </div>
    </div>
  )
}
