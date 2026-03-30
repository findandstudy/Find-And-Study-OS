import { useState, useRef, useEffect } from "react";
import { UserCheck, UserPlus, Search, X } from "lucide-react";

interface AssignPopoverProps {
  assignedUserName?: string;
  staffUsers: { id: number; name: string }[];
  currentUserId?: number;
  onAssign: (userId: number) => void;
  size?: "card" | "list";
}

export function AssignPopover({ assignedUserName, staffUsers, currentUserId, onAssign, size = "card" }: AssignPopoverProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const filtered = staffUsers.filter(u =>
    !search || u.name.toLowerCase().includes(search.toLowerCase())
  );

  const meFirst = currentUserId
    ? [...filtered.filter(u => u.id === currentUserId), ...filtered.filter(u => u.id !== currentUserId)]
    : filtered;

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); setSearch(""); }}
        className={`flex items-center gap-0.5 truncate ${
          assignedUserName
            ? `text-[10px] text-muted-foreground hover:text-primary transition-colors`
            : `text-[10px] text-primary hover:underline font-medium`
        }`}
        title={assignedUserName || "Assign staff member"}
      >
        {assignedUserName ? (
          <><UserCheck className="w-3 h-3 shrink-0" />{assignedUserName}</>
        ) : (
          <><UserPlus className="w-3 h-3 shrink-0" />Assign</>
        )}
      </button>
      {open && (
        <div
          className="absolute left-0 top-full mt-1 w-56 bg-popover border rounded-xl shadow-xl z-[100] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search staff..."
                className="w-full h-8 pl-7 pr-2 text-xs rounded-lg border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                autoFocus
              />
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {meFirst.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-3">No staff found</p>
            ) : (
              meFirst.map(u => (
                <button
                  key={u.id}
                  onClick={(e) => { e.stopPropagation(); onAssign(u.id); setOpen(false); }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors flex items-center gap-2"
                >
                  <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-primary text-[9px] font-bold shrink-0">
                    {u.name.split(" ").map(n => n[0]).join("").slice(0, 2)}
                  </div>
                  <span className="truncate">{u.name}</span>
                  {u.id === currentUserId && (
                    <span className="text-[9px] text-muted-foreground ml-auto shrink-0">(Me)</span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
