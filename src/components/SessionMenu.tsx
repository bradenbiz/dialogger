import Plus from "lucide-react/icons/plus";
import Trash2 from "lucide-react/icons/trash";
import type { SessionSummary } from "@/lib/api";
import { Skeleton } from "@/components/Skeleton";

interface SessionMenuProps {
  /** All sessions; undefined while the list loads (shows skeleton rows). */
  sessions?: SessionSummary[];
  activeSessionId?: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

/**
 * The session switcher dropdown. It only shows once opened, so it loads separately from the
 * main bundle (see TopBar).
 */
export function SessionMenu({
  sessions,
  activeSessionId,
  onSelect,
  onCreate,
  onDelete,
  onClose,
}: SessionMenuProps) {
  return (
    <>
      <div
        className="fixed inset-0 z-30"
        onClick={onClose}
      />
      <div className="absolute left-0 top-10 w-80 bg-white border border-stone-200 rounded-xl shadow-lg py-1.5 z-40">
        <div className="px-3 py-1.5 flex items-center justify-between border-b border-stone-100">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">
            Sessions
          </span>
          <button
            type="button"
            onClick={() => {
              onClose();
              onCreate();
            }}
            className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800"
          >
            <Plus className="w-3.5 h-3.5" /> New
          </button>
        </div>
        <div className="max-h-72 overflow-y-auto py-1">
          {!sessions &&
            [0, 1, 2].map((i) => (
              <div key={i} className="px-3 py-2 space-y-1.5">
                <Skeleton className="block w-40 h-3.5" />
                <Skeleton className="block w-28 h-2.5" />
              </div>
            ))}
          {sessions?.map((s) => (
            <div
              key={s.id}
              className={`group flex items-center justify-between px-3 py-2 text-sm cursor-pointer hover:bg-stone-50 ${
                s.id === activeSessionId ? "bg-blue-50/70 text-blue-900" : "text-stone-700"
              }`}
              onClick={() => {
                onClose();
                onSelect(s.id);
              }}
            >
              <div className="min-w-0 pr-2">
                <div className="font-medium truncate">{s.title}</div>
                <div className="text-[11px] text-stone-400">
                  {s.nodeCount} nodes · {s.turnCount} turns · {s.speakerCount} speakers
                </div>
              </div>
              {sessions.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(s.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 text-stone-400 hover:text-rose-600 rounded"
                  title="Delete session"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
