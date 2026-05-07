'use client';

import { Season } from '@/domain';

type PhaseTimelineProps = {
  year: number;
  season: Season;
  diplomacyPhase: 'negotiation' | 'orders';
  isRetreatPhase: boolean;
  isAdjustmentPhasePanel: boolean;
  isResolutionRevealing: boolean;
  rightAction?: React.ReactNode;
};

/**
 * 現在のフェーズに対応するインデックスを計算（0-8）
 */
function getCurrentPhaseIndex(
  season: Season,
  diplomacyPhase: 'negotiation' | 'orders',
  isRetreatPhase: boolean,
  isAdjustmentPhasePanel: boolean,
  isResolutionRevealing: boolean,
): number {
  const isFall = season === Season.Fall;
  const baseIndex = isFall ? 4 : 0;

  if (isAdjustmentPhasePanel) {
    return 8;
  }

  if (isRetreatPhase) {
    return baseIndex + 3;
  }

  if (isResolutionRevealing) {
    return baseIndex + 2;
  }

  if (diplomacyPhase === 'orders') {
    return baseIndex + 1;
  }

  return baseIndex;
}

const PHASE_LABELS = [
  '春交渉',
  '春命令',
  '春実行',
  '春解体',
  '秋交渉',
  '秋命令',
  '秋実行',
  '秋解体',
  '秋増産',
];

export function PhaseTimeline({
  year,
  season,
  diplomacyPhase,
  isRetreatPhase,
  isAdjustmentPhasePanel,
  isResolutionRevealing,
  rightAction,
}: PhaseTimelineProps) {
  const currentIndex = getCurrentPhaseIndex(
    season,
    diplomacyPhase,
    isRetreatPhase,
    isAdjustmentPhasePanel,
    isResolutionRevealing,
  );

  const seasonLabel = season === Season.Spring ? '春' : '秋';

  return (
    <div className="flex shrink-0 items-start justify-between gap-6 border-b border-zinc-200 bg-white px-4 py-4 flex-col lg:flex-row lg:items-start">
      {/* Left: Year/Season */}
      <div className="whitespace-nowrap font-semibold text-zinc-700 text-sm pt-6">
        {year}年 {seasonLabel}
      </div>

      {/* Center: Timeline with dots and line */}
      <div className="flex min-w-0 flex-1 items-start w-full lg:w-auto">
        <div className="relative w-full">
          {/* SVG for background line and segments */}
          <svg
            className="absolute left-0 top-0 h-8 w-full"
            preserveAspectRatio="none"
            style={{ pointerEvents: 'none' }}
          >
            {/* Completed segment line (blue-teal) */}
            <line
              x1={`${(currentIndex / (PHASE_LABELS.length - 1)) * 100}%`}
              y1="16"
              x2="0%"
              y2="16"
              stroke="#0891b2"
              strokeWidth="6"
            />
            {/* Future segment line (gray) */}
            <line
              x1={`${(currentIndex / (PHASE_LABELS.length - 1)) * 100}%`}
              y1="16"
              x2="100%"
              y2="16"
              stroke="#d4d4d8"
              strokeWidth="6"
            />
          </svg>

          {/* Dots and labels */}
          <div className="relative flex w-full items-start justify-between">
            {PHASE_LABELS.map((label, idx) => {
              const isCompleted = idx < currentIndex;
              const isCurrent = idx === currentIndex;
              const isFuture = idx > currentIndex;

              return (
                <div key={idx} className="flex flex-col items-center relative">
                  {/* Dot */}
                  <div
                    className={`h-6 w-6 rounded-full flex items-center justify-center relative z-20 transition-colors ${
                      isCompleted
                        ? 'bg-cyan-500 shadow-md'
                        : isCurrent
                          ? 'bg-orange-500 ring-2 ring-orange-300 shadow-md'
                          : 'bg-zinc-300 shadow-sm'
                    }`}
                  >
                    {isCompleted && (
                      <svg
                        className="h-4 w-4 text-white"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </div>
                  {/* Label below dot */}
                  <span className="mt-3 text-[11px] font-medium text-zinc-700 text-center whitespace-nowrap w-16">
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Right: Action button (desktop only) */}
      {rightAction && <div className="shrink-0 pt-1 hidden lg:block">{rightAction}</div>}
    </div>
  );
}
