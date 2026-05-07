'use client';

type AppHeaderProps = {
  displayName: string;
  onMenuClick: () => void;
};

export function AppHeader({ displayName, onMenuClick }: AppHeaderProps) {
  return (
    <header className="flex h-10 shrink-0 items-center justify-between bg-zinc-900 px-4 text-white">
      <div className="font-bold">Diplomacy</div>
      <div className="flex items-center gap-3">
        <span className="text-sm">{displayName}</span>
        <button
          onClick={onMenuClick}
          aria-label="メニューを開く"
          className="rounded px-1 py-0.5 hover:bg-zinc-700 transition-colors"
        >
          ≡
        </button>
      </div>
    </header>
  );
}
