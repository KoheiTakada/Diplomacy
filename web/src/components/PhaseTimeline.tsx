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
  const completedPct = (currentIndex / (PHASE_LABELS.length - 1)) * 100;

  return (
    <div className="flex shrink-0 items-start justify-between gap-6 border-b border-zinc-200 bg-white px-4 py-2 lg:py-4 flex-col lg:flex-row lg:items-start">
      {/* Left: Year/Season */}
      <div className="whitespace-nowrap font-semibold text-zinc-700 text-sm pt-0 lg:pt-4">
        {year}年 {seasonLabel}
      </div>

      {/* Center: Timeline */}
      <div className="flex min-w-0 flex-1 items-start w-full lg:w-auto">
        <div className="relative w-full">
          {/* Track: background bar */}
          <div className="absolute left-0 right-0 top-[7px] h-0.5 bg-zinc-200" />

          {/* Track: completed bar with transition (show first segment on spring negotiation) */}
          <div
            className="absolute left-0 top-[7px] h-0.5 bg-orange-500 transition-all duration-500 ease-in-out"
            style={{
              width:
                currentIndex === 0
                  ? `${(1 / (PHASE_LABELS.length - 1)) * 100}%`
                  : `${completedPct}%`,
            }}
          />

          {/* Dots and labels */}
          <div className="relative flex w-full items-start justify-between">
            {PHASE_LABELS.map((label, idx) => {
              const isCompleted = idx < currentIndex;
              const isCurrent = idx === currentIndex;

              return (
                <div key={idx} className="flex flex-col items-center">
                  {/* Dot */}
                  <div className="relative flex items-center justify-center">
                    <div
                      className={`relative h-4 w-4 rounded-full flex items-center justify-center transition-colors duration-300 z-10 ${
                        isCompleted || isCurrent
                          ? 'bg-cyan-500'
                          : 'bg-white border-2 border-zinc-300'
                      } ${isCurrent ? 'ring-2 ring-cyan-300' : ''}`}
                    >
                      {(isCompleted || isCurrent) && (
                        <svg
                          className="h-2.5 w-2.5 text-white"
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
                  </div>
                  {/* Label below dot */}
                  <span
                    className={`mt-2 text-[10px] font-medium text-center whitespace-nowrap w-14 transition-colors duration-300 ${
                      isCompleted || isCurrent
                        ? 'text-cyan-600'
                        : 'text-zinc-400'
                    }`}
                  >
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
