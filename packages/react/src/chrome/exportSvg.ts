/**
 * SVG 导出（GH-T4）：当前文档全图 → 独立 SVG 字符串（保持主题令牌；复用渲染侧 nodeCardStyle/buildLinkPath）。
 * view 缺省 = 布局 bounds 外扩 40px（全图导出）。
 */
import { filterVisibleLinks, isBoxInView, type LayoutResult } from '@mindcanvas/kernel';
import { buildLinkPath, computeBranchIndex, nodeCardStyle } from '../render/geometry.js';
import type { TokenSet } from '../theme/index.js';

export interface ExportSvgOptions {
  /** 世界坐标可见区域（缺省 = 全图 bounds 外扩） */
  view?: { x: number; y: number; w: number; h: number };
  title?: string;
}

export function exportSvg(
  layout: LayoutResult,
  token: TokenSet,
  opts: ExportSvgOptions = {},
): string {
  const b = layout.bounds;
  const view = opts.view ?? {
    x: b.minX - 40,
    y: b.minY - 40,
    w: b.maxX - b.minX + 80,
    h: b.maxY - b.minY + 80,
  };
  const boxes = new Map(layout.nodes.map((n) => [n.node.id, n.box]));
  const visibleLinks = filterVisibleLinks(layout.links, boxes, view, 64);
  const visibleNodes = layout.nodes.filter((n) => isBoxInView(n.box, view, 64));
  const branchIndex = computeBranchIndex(layout.nodes);

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r(view.x)} ${r(view.y)} ${r(view.w)} ${r(view.h)}" ` +
      `width="${r(view.w)}" height="${r(view.h)}"` +
      (opts.title ? `><title>${esc(opts.title)}</title>` : '>'),
  );
  parts.push(
    `<rect x="${r(view.x)}" y="${r(view.y)}" width="${r(view.w)}" height="${r(view.h)}" fill="${esc(token.color.canvas)}"/>`,
  );

  // 连线（复用渲染侧 path 构建；不传分支色 → 默认连线色）
  for (const l of visibleLinks) {
    const from = boxes.get(l.fromId);
    const to = boxes.get(l.toId);
    if (!from || !to) continue;
    const p = buildLinkPath(token, from, to);
    parts.push(
      `<path d="${esc(p.d)}" fill="none" stroke="${esc(p.stroke)}" stroke-width="${r(p.width)}"/>`,
    );
  }

  // 节点卡（nodeCardStyle 同款主题取值；全量文本——导出不套 LOD 省略）
  for (const n of visibleNodes) {
    const palette =
      token.color.branches[branchIndex.get(n.node.id) ?? 0] ?? token.color.branches[0]!;
    const entityKind = n.node.type === 'entity' ? (n.node.ref?.kind ?? null) : null;
    const style = nodeCardStyle(token, palette, n.depth >= 2 ? 'leaf' : 'branch', entityKind);
    const bx = n.box;
    parts.push(`<g transform="translate(${r(bx.x)} ${r(bx.y)})">`);
    parts.push(
      `<rect width="${r(bx.w)}" height="${r(bx.h)}" rx="${r(style.radius)}" fill="${esc(style.fill)}" ` +
        `stroke="${esc(style.stroke)}" stroke-width="${r(style.strokeWidth)}"/>`,
    );
    parts.push(
      `<text x="${r(bx.w / 2)}" y="${r(bx.h / 2)}" text-anchor="middle" dominant-baseline="central" ` +
        `font-family="${esc(token.font.family)}" font-size="${n.depth >= 2 ? token.font.sizeLeaf : token.font.size}" ` +
        `font-weight="${n.depth === 0 ? token.font.weightRoot : token.font.weight}" fill="${esc(style.text)}">` +
        `${esc(n.node.text ?? '')}</text>`,
    );
    parts.push('</g>');
  }
  parts.push('</svg>');
  return parts.join('');
}

function r(v: number): string {
  return Math.round(v * 10) / 10 + '';
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
