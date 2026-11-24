export function PostCardSkeleton() {
  return (
    <div className="glass-card rounded-2xl overflow-hidden animate-pulse">
      <div className="px-4 sm:px-5 pt-4 pb-3 flex items-center gap-3">
        <div className="w-11 h-11 rounded-full bg-hover-tint shrink-0" />
        <div className="space-y-2 flex-1 min-w-0">
          <div className="h-3.5 w-36 bg-hover-tint rounded-md" />
          <div className="h-2.5 w-24 bg-hover-tint rounded-md" />
        </div>
      </div>
      <div className="px-4 sm:px-5 pb-3 space-y-2">
        <div className="h-3 w-4/5 bg-hover-tint rounded-md" />
        <div className="h-3 w-1/2 bg-hover-tint rounded-md" />
      </div>
      <div className="px-4 sm:px-5 pb-3">
        <div className="aspect-[4/3] w-full rounded-xl bg-hover-tint" />
      </div>
      <div className="px-4 sm:px-5 pb-3.5 pt-2 border-t border-hairline grid grid-cols-4 gap-2">
        <div className="h-8 rounded-xl bg-hover-tint" />
        <div className="h-8 rounded-xl bg-hover-tint" />
        <div className="h-8 rounded-xl bg-hover-tint" />
        <div className="h-8 rounded-xl bg-hover-tint" />
      </div>
    </div>
  );
}

export function MemberCardSkeleton() {
  return (
    <div className="glass-card rounded-2xl p-5 animate-pulse flex items-center gap-3.5">
      <div className="w-12 h-12 rounded-full bg-hover-tint shrink-0" />
      <div className="space-y-2 flex-1">
        <div className="h-3.5 w-28 bg-hover-tint rounded" />
        <div className="h-3 w-20 bg-hover-tint rounded" />
      </div>
    </div>
  );
}

export function StoriesStripSkeleton() {
  return (
    <div
      aria-label="Loading stories"
      className="flex items-start gap-3.5 overflow-hidden py-0.5"
    >
      {Array.from({ length: 6 }).map((_, idx) => (
        <div
          key={idx}
          className="w-[74px] flex flex-col items-center gap-2 shrink-0 animate-pulse"
        >
          <div className="w-[62px] h-[62px] rounded-full bg-hover-tint border border-hairline" />
          <div className="h-2.5 w-12 rounded bg-hover-tint" />
        </div>
      ))}
    </div>
  );
}

export function ProfilePageSkeleton() {
  return (
    <div aria-label="Loading profile" className="space-y-6">
      <div className="glass-card rounded-2xl overflow-hidden animate-pulse">
        <div className="h-44 sm:h-60 bg-hover-tint" />
        <div className="px-5 sm:px-7 pb-6 -mt-12 sm:-mt-14 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div className="flex items-end gap-4">
              <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-surface-hover border-4 border-surface shrink-0" />
              <div className="space-y-2 pb-1">
                <div className="h-6 w-44 rounded-md bg-hover-tint" />
                <div className="h-3.5 w-28 rounded-md bg-hover-tint" />
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <div className="h-10 w-28 rounded-xl bg-hover-tint" />
              <div className="h-10 w-28 rounded-xl bg-hover-tint" />
            </div>
          </div>
          <div className="space-y-2 max-w-xl">
            <div className="h-3.5 w-full rounded bg-hover-tint" />
            <div className="h-3.5 w-2/3 rounded bg-hover-tint" />
          </div>
          <div className="grid grid-cols-3 gap-3 max-w-md pt-2 border-t border-hairline">
            <div className="h-10 rounded-lg bg-hover-tint" />
            <div className="h-10 rounded-lg bg-hover-tint" />
            <div className="h-10 rounded-lg bg-hover-tint" />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 border-b border-hairline pb-3 animate-pulse">
        <div className="h-9 w-24 rounded-xl bg-hover-tint" />
        <div className="h-9 w-24 rounded-xl bg-hover-tint" />
        <div className="h-9 w-24 rounded-xl bg-hover-tint" />
      </div>
      <PostCardSkeleton />
    </div>
  );
}

export function ExploreDiscoverySkeleton() {
  return (
    <div aria-label="Loading discovery" className="space-y-6 animate-pulse">
      <div className="flex items-stretch gap-3 overflow-hidden">
        {Array.from({ length: 4 }).map((_, idx) => (
          <div
            key={idx}
            className="w-64 shrink-0 glass-card rounded-2xl p-4 space-y-3"
          >
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-hover-tint shrink-0" />
              <div className="space-y-2 flex-1 min-w-0">
                <div className="h-3.5 w-28 rounded bg-hover-tint" />
                <div className="h-2.5 w-20 rounded bg-hover-tint" />
              </div>
            </div>
            <div className="h-3 w-4/5 rounded bg-hover-tint" />
            <div className="h-9 w-full rounded-xl bg-hover-tint" />
          </div>
        ))}
      </div>

      <div className="columns-1 sm:columns-2 lg:columns-3 gap-4 space-y-4">
        {['aspect-[4/5]', 'aspect-square', 'aspect-[4/3]', 'aspect-[4/5]', 'aspect-square', 'aspect-[4/3]'].map(
          (aspect, idx) => (
            <div
              key={idx}
              className="break-inside-avoid rounded-2xl glass-card overflow-hidden"
            >
              <div className={`${aspect} w-full bg-hover-tint`} />
              <div className="p-3.5 space-y-2.5">
                <div className="h-3 w-3/4 rounded bg-hover-tint" />
                <div className="flex items-center justify-between pt-1">
                  <div className="h-3 w-24 rounded bg-hover-tint" />
                  <div className="h-3 w-16 rounded bg-hover-tint" />
                </div>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}

