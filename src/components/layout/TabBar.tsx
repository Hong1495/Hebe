import { basename } from "../../lib/path";
import { useAppStore } from "../../stores/app-store";

interface Props {
  onCloseTab?: (index: number) => void | boolean | Promise<void | boolean>;
}

export function TabBar({ onCloseTab }: Props) {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabIndex = useAppStore((s) => s.activeTabIndex);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const requestCloseTab = onCloseTab ?? closeTab;

  return (
    <div className="tab-bar flex items-center gap-0 px-2 shrink-0 overflow-x-auto">
      <div className="tab-traffic-spacer" data-tauri-drag-region />
      {tabs.length > 1 &&
        tabs.map((tab, i) => {
          const isActive = i === activeTabIndex;
          const title = tab.path ? basename(tab.path) : tab.content ? "Untitled" : "New Tab";

          return (
            <button
              key={`${tab.path ?? "new"}-${i}`}
              type="button"
              onMouseDown={(e) => {
                if (e.button !== 0) return;
                setActiveTab(i);
              }}
              onClick={() => setActiveTab(i)}
              onContextMenu={(e) => {
                e.preventDefault();
                const menu = document.createElement("div");
                menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:9999;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:4px;min-width:160px;box-shadow:0 4px 12px rgba(0,0,0,0.15);`;
                const menuItems: [string, () => void][] = [
                  ["Close", () => void requestCloseTab(i)],
                  ...(i > 0
                    ? ([["Move Left", () => useAppStore.getState().moveTab(i, i - 1)]] as [
                        string,
                        () => void,
                      ][])
                    : []),
                  ...(i < tabs.length - 1
                    ? ([["Move Right", () => useAppStore.getState().moveTab(i, i + 1)]] as [
                        string,
                        () => void,
                      ][])
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
              className={`tab-item flex items-center gap-2 shrink-0 max-w-[220px] ${
                isActive ? "is-active" : ""
              }`}
              style={{
                background: isActive ? "var(--bg)" : "transparent",
                color: isActive ? "var(--text-heading)" : "var(--text-secondary)",
              }}
              title={tab.path ?? "Untitled"}
            >
              <span className={`tab-state ${tab.dirty ? "is-dirty" : ""}`} />
              <span className="truncate">{title}</span>
              <span
                className="tab-close"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  void requestCloseTab(i);
                }}
              >
                ×
              </span>
            </button>
          );
        })}
      <div className="tab-fill-drag-region" data-tauri-drag-region />
    </div>
  );
}
