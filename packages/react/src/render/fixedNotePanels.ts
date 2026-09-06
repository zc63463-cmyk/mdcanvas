import { noteOf } from '@mindcanvas/kernel';
import type { Box } from '@mindcanvas/kernel';
import { nodeAuxiliaryRegions } from './nodeAuxiliary.js';
import { FIXED_NOTE_GAP } from '../chrome/NoteGrowthPanel.js';

export interface FixedNotePanelData {
  id: string;
  data: ReturnType<typeof noteOf>;
  editing: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LayoutNodeLike {
  node: { id: string };
  box: Box;
}

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * 固定 note 笔记仅为视口内节点生成 HTML 面板。
 * 一次扫描建立 id 索引，避免每个固定项重新遍历全量 layout.nodes。
 */
export function fixedNotePanelsOf<T extends LayoutNodeLike>(
  layout: { nodes: readonly T[] },
  fixedIds: ReadonlySet<string>,
  editingIds: ReadonlySet<string>,
  visibleWorld: Box,
  transform: { k: number; x: number; y: number },
  fixedNoteHeight: number,
): FixedNotePanelData[] {
  if (fixedIds.size === 0) return [];
  const nodesById = new Map<string, T>();
  for (const node of layout.nodes) nodesById.set(node.node.id, node);

  const panels: FixedNotePanelData[] = [];
  for (const id of fixedIds) {
    const ln = nodesById.get(id);
    // 初次挂载时 ResizeObserver 尚未给出容器尺寸；此时不裁剪，避免固定面板首帧消失。
    const hasViewportSize = visibleWorld.w > 0 && visibleWorld.h > 0;
    if (!ln || (hasViewportSize && !intersects(ln.box, visibleWorld))) continue;
    const region = nodeAuxiliaryRegions(ln.box.h, { fixedNoteHeight }).fixedNote;
    if (!region) continue;
    panels.push({
      id,
      data: noteOf(ln.node as never),
      editing: editingIds.has(id),
      x: ln.box.x * transform.k + transform.x,
      y: (ln.box.y + region.y + Math.min(FIXED_NOTE_GAP, region.h)) * transform.k + transform.y,
      width: ln.box.w * transform.k,
      height: Math.max(0, region.h - FIXED_NOTE_GAP) * transform.k,
    });
  }
  return panels;
}
