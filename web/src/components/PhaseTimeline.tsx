'use client';

import { Season } from '@/domain';

type PhaseTimelineProps = {
  year: number;
  season: Season;
  diplomacyPhase: 'negotiation' | 'orders';
  isRetreatPhase: boolean;
  isAdjustmentPhasePanel: boolean;
  isResolutionRevealing: boolean;
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
    // Fall のみ有効。Fall + isAdjustmentPhasePanel = index 8
    return 8;
  }

  if (isRetreatPhase) {
    // Spring retreat = 3, Fall retreat = 7
    return baseIndex + 3;
  }

  if (isResolutionRevealing) {
    // Spring resolution = 2, Fall resolution = 6
    return baseIndex + 2;
  }

  if (diplomacyPhase === 'orders') {
    // Spring orders = 1, Fall orders = 5
    return baseIndex + 1;
  }

  // diplomacyPhase === 'negotiation'
  // Spring negotiation = 0, Fall negotiation = 4
  return baseIndex;
}

const PHASE_LABELS = [
  { label: '春交渉', season: Season.Spring },
  { label: '春命令', season: Season.Spring },
  { label: '春実行', season: Season.Spring },
  { label: '春解体', season: Season.Spring },
  { label: '秋交渉', season: Season.Fall },
  { label: '秋命令', season: Season.Fall },
  { label: '秋実行', season: Season.Fall },
  { label: '秋解体', season: Season.Fall },
  { label: '秋増産', season: Season.Fall },
];

export function PhaseTimeline({
  year,
  season,
  diplomacyPhase,
  isRetreatPhase,
  isAdjustmentPhasePanel,
  isResolutionRevealing,
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
    <div className="flex shrink-0 items-center gap-4 border-b border-zinc-200 bg-white px-4 py-2 text-xs">
      <div className="whitespace-nowrap font-semibold text-zinc-700">
        {year}年 {seasonLabel}
      </div>
      <div className="flex items-center gap-1.5">
        {PHASE_LABELS.map((phase, idx) => (
          <div key={idx} className="flex flex-col items-center gap-0.5">
            <div
              className={`h-2 w-2 rounded-full transition-colors ${
                idx < currentIndex
                  ? 'bg-orange-500' // 完了
                  : idx === currentIndex
                    ? 'bg-white ring-2 ring-zinc-400' // 現在
                    : 'bg-zinc-300' // 未来
              }`}
            />
            {idx % 2 === 0 && (
              <span className="text-[10px] text-zinc-500">{phase.label}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
