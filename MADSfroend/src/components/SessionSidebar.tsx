import type { GroupedHistories, HistoryItem } from "../types/chat";

const GROUP_TITLES: Array<[keyof GroupedHistories, string]> = [
  ["TODAY", "今天的主题"],
  ["LAST_WEEK", "最近一周"],
  ["LAST_MONTH", "最近一个月"],
  ["LAST_YEAR", "最近一年"],
  ["OTHERS", "更早的主题"],
];

interface SessionSidebarProps {
  collapsed: boolean;
  histories: GroupedHistories;
  loading: boolean;
  searchKeyword: string;
  activeHistoryId: string | null;
  showMenuId: string | null;
  menuPosition: { top: number; left: number } | null;
  renameHistory: HistoryItem | null;
  renameValue: string;
  onToggleCollapse: () => void;
  onSearchKeywordChange: (value: string) => void;
  onSearch: () => void;
  onCreateNewDialog: () => void;
  onSelectHistory: (id: string) => void;
  onShowMenu: (id: string, rect: DOMRect) => void;
  onHideMenu: () => void;
  onRenameStart: (item: HistoryItem) => void;
  onRenameValueChange: (value: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  onDeleteClick: (id: string) => void;
}

export default function SessionSidebar({
  collapsed,
  histories,
  loading,
  searchKeyword,
  activeHistoryId,
  showMenuId,
  menuPosition,
  renameHistory,
  renameValue,
  onToggleCollapse,
  onSearchKeywordChange,
  onSearch,
  onCreateNewDialog,
  onSelectHistory,
  onShowMenu,
  onHideMenu,
  onRenameStart,
  onRenameValueChange,
  onRenameSubmit,
  onRenameCancel,
  onDeleteClick,
}: SessionSidebarProps) {
  const allHistories = GROUP_TITLES.flatMap(([groupKey]) => histories[groupKey] ?? []);

  return (
    <aside className={collapsed ? "mads-sidebar collapsed" : "mads-sidebar"}>
      <div className="sidebar-actions">
        {!collapsed && (
          <>
            <div className="sidebar-title">主题</div>
            <button className="primary-btn full-width" onClick={onCreateNewDialog}>
              新建主题
            </button>
            <div className="search-row">
              <input
                className="mads-input"
                placeholder="搜索主题"
                value={searchKeyword}
                onChange={(event) => onSearchKeywordChange(event.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") onSearch(); }}
              />
              <button className="primary-btn small-btn" onClick={onSearch}>
                搜索
              </button>
            </div>
          </>
        )}
        <button className="collapse-btn" onClick={onToggleCollapse} title="收起/展开侧边栏">
          {collapsed ? ">" : "<"}
        </button>
      </div>

      {!collapsed && (
        <div className="history-section">
          {loading && <div className="muted-tip">历史加载中...</div>}
          {!loading &&
            GROUP_TITLES.map(([groupKey, title]) => {
              const items = histories[groupKey] ?? [];
              if (items.length === 0) return null;
              return (
                <section key={groupKey}>
                  <h4 className="history-title">{title}</h4>
                  {items.map((item) => (
                    <div key={item.id} className={activeHistoryId === item.id ? "history-item active" : "history-item"}>
                      <div
                        className="history-name"
                        onClick={() => onSelectHistory(item.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") onSelectHistory(item.id);
                        }}
                      >
                        {renameHistory?.id === item.id ? (
                          <span className="rename-row">
                            <input
                              className="mads-input inline-input"
                              value={renameValue}
                              onChange={(event) => onRenameValueChange(event.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") onRenameSubmit(); if (e.key === "Escape") onRenameCancel(); }}
                              autoFocus
                            />
                            <button className="icon-btn" onClick={onRenameCancel}>x</button>
                            <button className="icon-btn" onClick={() => { onRenameSubmit(); }}>v</button>
                          </span>
                        ) : (
                          item.title
                        )}
                      </div>
                      {renameHistory?.id !== item.id && (
                        <div className="menu-wrapper">
                          <button
                            className="icon-btn"
                            onClick={(event) => {
                              if (showMenuId === item.id) {
                                onHideMenu();
                                return;
                              }
                              const rect = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
                              onShowMenu(item.id, rect);
                            }}
                          >
                            ...
                          </button>
                          {showMenuId === item.id && (
                            <div
                              className="item-menu"
                              style={menuPosition ? { top: `${menuPosition.top}px`, left: `${menuPosition.left}px` } : undefined}
                            >
                              <button className="menu-item-btn" onClick={() => { onRenameStart(item); onHideMenu(); }}>
                                <span className="menu-item-icon">✎</span>
                                <span>重命名</span>
                              </button>
                              <button className="menu-item-btn" onClick={() => onHideMenu()}>
                                <span className="menu-item-icon">☆</span>
                                <span>收藏（预留）</span>
                              </button>
                              <div className="menu-divider" />
                              <button className="menu-item-btn danger" onClick={() => { onDeleteClick(item.id); onHideMenu(); }}>
                                <span className="menu-item-icon">🗑</span>
                                <span>删除</span>
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </section>
              );
            })}
          {!loading && allHistories.length === 0 && <div className="muted-tip">暂无主题，点击上方"新建主题"开始</div>}
        </div>
      )}
    </aside>
  );
}
