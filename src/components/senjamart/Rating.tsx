interface RatingProps {
  rating: number;
  reviewCount?: number;
  showCount?: boolean;
}

const STAR_PATH =
  'M8.243 7.34l-6.38.925l-.113.035a1 1 0 0 0 -.522 1.726l4.622 4.499l-1.09 6.355l-.013.11a1 1 0 0 0 1.464.944l5.706 -3l5.693 3l.1.046a1 1 0 0 0 1.352 -1.1l-1.091 -6.355l4.624 -4.5l.078 -.085a1 1 0 0 0 -.633 -1.575l-6.38 -.926l-2.852 -5.78a1 1 0 0 0 -1.794 0l-2.853 5.78z';

function StarShape({
  fill,
  strokeColor,
}: {
  fill: string;
  strokeColor: string;
}) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill={fill}
      className="text-fresh-yellow-500"
      aria-hidden="true"
    >
      <path d={STAR_PATH} stroke={strokeColor} strokeWidth="0.5" />
    </svg>
  );
}

/** Star rating row — renders full / half / empty stars from a 0-5 value. */
export default function Rating({
  rating,
  reviewCount,
  showCount = true,
}: RatingProps) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center gap-0.5">
        {Array.from({ length: 5 }, (_, i) => {
          const value = Math.max(0, Math.min(5, rating - i));
          if (value >= 0.75) {
            return <StarShape key={i} fill="currentColor" strokeColor="currentColor" />;
          }
          if (value >= 0.25) {
            // Half star: empty star with a 50%-wide yellow fill overlay.
            return (
              <span key={i} className="relative inline-block leading-none">
                <StarShape fill="#dfe2e1" strokeColor="#dfe2e1" />
                <span
                  className="absolute left-0 top-0 overflow-hidden text-fresh-yellow-500"
                  style={{ width: '50%' }}
                >
                  <StarShape fill="currentColor" strokeColor="currentColor" />
                </span>
              </span>
            );
          }
          return <StarShape key={i} fill="#dfe2e1" strokeColor="#dfe2e1" />;
        })}
      </div>
      {showCount && (
        <span className="text-sm text-fresh-gray-500">
          ({reviewCount ?? 0})
        </span>
      )}
    </div>
  );
}
