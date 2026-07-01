import { useAppStore } from "../../stores/app-store";

export function TabBar() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabIndex = useAppStore((s) => s.activeTabIndex);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const closeTab = useAppStore((s) => s.closeTab);

  if (tabs.length <= 1) return null;

  return (
    <div
      className="flex items-center gap-0 px-1 py-0 shrink-0 overflow-x-auto"
      style={{
        background: "var(--surface)",
        borderBottom: "1px solid var(--border)",
        minHeight: 32,
      }}
    >
      {tabs.map((tab, i) => {
        const isActive = i === activeTabIndex;
        const title = tab.path ? tab.path.split("/").pop()! : tab.content ? "Untitled" : "New Tab";

        return (
          <button
            key={`${tab.path ?? "new"}-${i}`}
            type="button"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", String(i));
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }}
            onDrop={(e) => {
              e.preventDefault();
              const fromIdx = Number.parseInt(e.dataTransfer.getData("text/plain"), 10);
              if (!Number.isNaN(fromIdx) && fromIdx !== i) {
                useAppStore.getState().moveTab(fromIdx, i);
              }
            }}
            onClick={() => setActiveTab(i)}
            onContextMenu={(e) => {
              e.preventDefault();
              const menu = document.createElement("div");
              menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:9999;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:4px;min-width:160px;box-shadow:0 4px 12px rgba(0,0,0,0.15);`;
              const menuItems: [string, () => void][] = [
                ["Close", () => closeTab(i)],
                ...(i > 0
                  ? ([["Move Left", () => useAppStore.getState().moveTab(i, i - 1)]] as [string, () => void][])
                  : []),
                ...(i < tabs.length - 1
                  ? ([["Move Right", () => useAppStore.getState().moveTab(i, i + 1)]] as [string, () => void][])
                  : []),
              ];
              menuItems.forEach(([label, action]) => {
                const btn = document.createElement("button");
                btn.textContent = label;
                btn.style.cssText =
                  "display:block;width:100%;text-align:left;padding:4px 8px;font-size:12px;border-radius:4px;border:none;background:transparent;color:var(--text);cursor:pointer;";
                btn.onmouseenter = () => {
                  btn.style.background = "var(--accent-bg)";
                };
                btn.onmouseleave = () => {
                  btn.style.background = "transparent";
                };
                btn.onclick = () => {
                  action();
                  menu.remove();
                };
                menu.appendChild(btn);
              });
              document.body.appendChild(menu);
              const closeMenu = () => menu.remove();
              setTimeout(() => document.addEventListener("click", closeMenu, { once: true }), 0);
            }}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-t transition-colors shrink-0 max-w-[180px]"
            style={{
              background: isActive ? "var(--bg)" : "transparent",
              color: isActive ? "var(--accent)" : "var(--text-secondary)",
              borderBottom: isActive ? `2px solid var(--accent)` : "2px solid transparent",
              marginBottom: "-1px",
            }}
            title={tab.path ?? "Untitled"}
          >
            <span className={tab.dirty ? "opacity-60" : ""}>{tab.dirty ? "●" : "○"}</span>
            <span className="truncate">{title}</span>
            <span
              className="ml-1 hover:opacity-50 transition-opacity text-xs"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(i);
              }}
              style={{ color: "var(--text-secondary)" }}
            >
              ×
            </span>
          </button>
        );
      })}
    </div>
  );
}
