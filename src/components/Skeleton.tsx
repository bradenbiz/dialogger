/**
 * Pulsing placeholder for a value that's still loading. Inline, so it can stand in for a
 * word or number inside text; `className` sets its size (e.g. "w-24 h-3").
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block align-middle animate-pulse rounded bg-stone-200 ${className}`}
    />
  );
}
