interface SkeletonProps {
  width?: string;
  height?: string;
  className?: string;
}

/** Shimmering placeholder block used while data is loading. */
export function Skeleton({ width = '100%', height = '1rem', className = '' }: SkeletonProps) {
  return (
    <div
      className={`skeleton ${className}`.trim()}
      style={{ width, height }}
      role="presentation"
      aria-hidden="true"
    />
  );
}
