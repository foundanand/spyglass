// Shimmering placeholder rows for loading states. One `.skeleton` class drives
// the shimmer; see index.html.

export function Skeleton({ w = "100%", h = 14 }: { w?: string; h?: number }) {
  return <span class="skeleton" style={`width:${w};height:${h}px`} />;
}

// A block of stacked skeleton lines for table/list loading.
export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div class="skeleton-rows">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} class="skeleton-row">
          <Skeleton w="18%" />
          <Skeleton w="52%" />
          <Skeleton w="14%" />
        </div>
      ))}
    </div>
  );
}
