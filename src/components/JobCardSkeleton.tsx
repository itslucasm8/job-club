export default function JobCardSkeleton() {
  return (
    <div className="rounded-[14px] bg-warm-card shadow-[0_1px_3px_rgba(0,0,0,0.08)] p-5 animate-pulse">
      {/* Header: avatar + text */}
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-full bg-stone-200" />
        <div>
          <div className="h-3.5 bg-stone-200 rounded w-24 mb-1.5" />
          <div className="h-3 bg-stone-100 rounded w-16" />
        </div>
      </div>
      {/* Title + location */}
      <div className="mt-3">
        <div className="h-4 bg-stone-200 rounded w-3/4 mb-2" />
        <div className="h-3 bg-stone-100 rounded w-1/2" />
      </div>
      {/* Description lines */}
      <div className="mt-2.5 space-y-1.5">
        <div className="h-3 bg-stone-100 rounded w-full" />
        <div className="h-3 bg-stone-100 rounded w-4/5" />
        <div className="h-3 bg-stone-100 rounded w-2/3" />
      </div>
      {/* Tags */}
      <div className="flex gap-2 mt-3">
        <div className="h-6 bg-stone-100 rounded-full w-16" />
        <div className="h-6 bg-stone-100 rounded-full w-12" />
        <div className="h-6 bg-stone-100 rounded-full w-20" />
      </div>
    </div>
  )
}
