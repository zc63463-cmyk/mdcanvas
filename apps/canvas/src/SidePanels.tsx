/**
 * 侧面板簇（S1：互斥单态）—— 搜索 / 大纲 / 图库 / 关系图谱。
 *
 * 从 `MindmapStage` 的 StageContent 拆出，属代码结构规范化 T1 的第 3 小步。
 *
 * 为什么能整体抽：这四个面板共享 S1 的**互斥单态**管理（`panel`），
 * 同一时刻最多显示一个，是天然的单一职责单元。抽走后 StageContent
 * 只剩「画布 + 编辑器浮层 + 工具栏」。
 *
 * 不是什么：不含实体 picker / 边编辑器 / 右键菜单——它们不是 `panel` 单态的一部分，
 * 各自有独立的开关状态，仍留在 StageContent。
 */
import type { Entity } from '@mindcanvas/kernel';
import type { AssetHost, AssetItem, EditorController, EntityRelation } from '@mindcanvas/react';
import {
  AssetPanel,
  EntityGraphPanel,
  OutlinePanel,
  SearchPanel,
  searchMind,
} from '@mindcanvas/react';
import type { ComponentProps, Dispatch, SetStateAction } from 'react';

/** 侧面板的互斥状态（null = 全关） */
export type PanelId = 'search' | 'outline' | 'assets' | 'relation' | null;

export interface SidePanelsProps {
  /** 当前打开的面板（互斥；null 时本组件渲染为空） */
  panel: PanelId;
  controller: EditorController;
  /** 图库：资产清单（异步加载） */
  assetList: AssetItem[];
  assetHost: AssetHost;
  setEntities: Dispatch<SetStateAction<Map<string, Entity>>>;
  /** 关系图谱：实体关系 + 当前选中实体的 key + 语义边清单 */
  relations: EntityRelation[];
  activeRefKey: string | null;
  /** 形状跟随 EntityGraphPanel 的 edges（用 ComponentProps 推导，避免依赖其内部类型名） */
  edgeItems: ComponentProps<typeof EntityGraphPanel>['edges'];
  /** 定位并选中节点（由调用方封装「收起快速注释展开态 + 画布定位」） */
  onSelectNode: (id: string) => void;
  onClose: () => void;
}

export function SidePanels({
  panel,
  controller,
  assetList,
  assetHost,
  setEntities,
  relations,
  activeRefKey,
  edgeItems,
  onSelectNode,
  onClose,
}: SidePanelsProps) {
  if (panel === null) return null;

  return (
    <>
      {panel === 'search' && (
        <SearchPanel
          search={(q) => searchMind(controller.root, q)}
          onSelect={onSelectNode}
          onClose={onClose}
        />
      )}

      {panel === 'outline' && (
        <OutlinePanel
          root={controller.root}
          collapsed={controller.collapsed}
          selectedId={controller.selectedId}
          onSelect={onSelectNode}
          onToggle={(id) => controller.toggleCollapse(id)}
        />
      )}

      {panel === 'assets' && (
        <AssetPanel
          assets={assetList}
          resolve={(item) => assetHost.resolveAsset(item)}
          onInsert={(item) => {
            if (!controller.selectedId) return;
            const id = controller.addEntityChild(controller.selectedId, {
              kind: item.kind,
              id: item.id,
            });
            setEntities((prev) => {
              const next = new Map(prev);
              next.set(`${item.kind}:${item.id}`, {
                kind: item.kind,
                id: item.id,
                title: item.name,
                status: 'ready',
                ref: null,
              });
              return next;
            });
            controller.select(id);
            onClose();
          }}
          onClose={onClose}
        />
      )}

      {panel === 'relation' && (
        <EntityGraphPanel
          relations={relations}
          activeRefKey={activeRefKey}
          edges={edgeItems}
          onFocusNode={onSelectNode}
          onClose={onClose}
        />
      )}
    </>
  );
}
