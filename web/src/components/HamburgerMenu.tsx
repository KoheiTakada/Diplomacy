'use client';

type HamburgerMenuProps = {
  open: boolean;
  isHostOrLocal: boolean;
  onClose: () => void;
  onSecrets?: () => void;
  onDebugLog?: () => void;
  onBoardEdit?: () => void;
  onLeave: () => void;
};

export function HamburgerMenu({
  open,
  isHostOrLocal,
  onClose,
  onSecrets,
  onDebugLog,
  onBoardEdit,
  onLeave,
}: HamburgerMenuProps) {
  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
        role="presentation"
      />
      <div className="fixed right-4 top-12 z-50 w-56 rounded-xl bg-zinc-800 shadow-xl">
        <div className="flex flex-col text-white">
          {isHostOrLocal && onSecrets && (
            <button
              onClick={() => {
                onSecrets();
                onClose();
              }}
              className="border-b border-zinc-700 px-4 py-2 text-left text-sm transition-colors hover:bg-zinc-700"
            >
              シークレットを出力
            </button>
          )}
          {onDebugLog && (
            <button
              onClick={() => {
                onDebugLog();
                onClose();
              }}
              className={`px-4 py-2 text-left text-sm transition-colors hover:bg-zinc-700 ${
                isHostOrLocal && onSecrets ? 'border-b border-zinc-700' : ''
              }`}
            >
              デバッグログ出力
            </button>
          )}
          {isHostOrLocal && onBoardEdit && (
            <button
              onClick={() => {
                onBoardEdit();
                onClose();
              }}
              className="border-b border-zinc-700 px-4 py-2 text-left text-sm transition-colors hover:bg-zinc-700"
            >
              盤面修正
            </button>
          )}
          <button
            onClick={() => {
              onLeave();
              onClose();
            }}
            className="border-t border-zinc-700 px-4 py-2 text-left text-sm transition-colors hover:bg-zinc-700"
          >
            退出する
          </button>
        </div>
      </div>
    </>
  );
}
