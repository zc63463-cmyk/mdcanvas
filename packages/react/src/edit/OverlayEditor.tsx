/**
 * OverlayEditor —— 节点文本内联编辑（F2 进入 / Enter 提交 / Esc 取消 / blur 提交）。
 * 绝对定位在节点盒上方（屏幕坐标由 MapView 计算）；输入框事件 stopPropagation
 * 防止冒泡到全局快捷键（避免输入时误触 Tab/Enter 新建）。
 *
 * 视觉口径（K4 后补）：与 NodeG 保持一致
 * - 字号 / 字重：随 depth 走（叶 sizeLeaf / 分支 size；根 weightRoot）
 * - 垂直居中：lineHeight = 节点盒高
 * - 选中态：selection 描边 + 柔和 inset 阴影 + 节点同底色（与玻璃主题一致）
 * - 全选：setSelectionRange（不再 execCommand 避免遗留高亮）
 */
import { useEffect, useRef, useState } from 'react';
import type { TokenSet } from '../theme/types.js';

export interface OverlayEditorProps {
  x: number;
  y: number;
  w: number;
  h: number;
  initial: string;
  token: TokenSet;
  /** 节点深度（决定字号字重） */
  depth: number;
  /** 是否根节点（决定字重） */
  root: boolean;
  /** 视口缩放（k）：所有边框/阴影按 k 缩放保持比例 */
  scale: number;
  onCommit: (text: string) => void;
  onCancel: () => void;
  /**
   * v1.3.0：Shift+Enter 请求切换到「描述编辑」（幕布「切换主题与描述」语义）。
   * 未注入时 Shift+Enter 退化为普通提交（向后兼容既有行为）。
   */
  onRequestDesc?: () => void;
}

export function OverlayEditor({
  x,
  y,
  w,
  h,
  initial,
  token,
  depth,
  root,
  scale,
  onCommit,
  onCancel,
  onRequestDesc,
}: OverlayEditorProps) {
  const [value, setValue] = useState(initial);
  const escapedRef = useRef(false);
  const committedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 节点本体口径：叶 = sizeLeaf / 分支 = size；根 = weightRoot
  const isLeaf = depth >= 2;
  const fontSize = (isLeaf ? token.font.sizeLeaf : token.font.size) * scale;
  const fontWeight = root ? token.font.weightRoot : token.font.weight;
  // 行高 = 节点盒高（与 NodeG LINE_H 视觉等价：单行占满盒高）
  const lineHeight = h;
  // 边距：内 padding 8px 跟节点 contentX 一致；边框随 k 缩放
  const padX = 8 * scale;
  const borderW = 1.5 * scale;
  const shadowBlur = 6 * scale;
  const insetBlur = 2 * scale;

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    // 全选便于覆盖输入（避免 execCommand 副作用；用原生 selection API）
    try {
      el.setSelectionRange(0, value.length);
    } catch {
      /* number 类型 input 才抛——我们用的是 text，忽略 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = (text: string): void => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommit(text);
  };

  const cancel = (): void => {
    if (committedRef.current) return;
    escapedRef.current = true;
    onCancel();
  };

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation(); // 关键：拦截全局快捷键（Tab/Enter 不新建）
        // v1.3.0：Shift+Enter = 切换「主题 → 描述」编辑（幕布语义），优先于提交。
        // 原实现把 Shift+Enter 也当 Enter 提交，"切换主题与描述" 快捷键因此在编辑态失效。
        if (e.key === 'Enter' && e.shiftKey && onRequestDesc) {
          e.preventDefault();
          commit(value); // 先落盘主题文本（防丢失），再切到描述编辑
          onRequestDesc();
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          commit(value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        }
      }}
      onBlur={() => {
        if (!escapedRef.current) commit(value);
      }}
      spellCheck={false}
      autoComplete="off"
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        boxSizing: 'border-box',
        // 边角对齐节点：节点圆角随尺度变换（≤8 截断 8 防内凹）
        borderRadius: Math.min(token.radius.node, h / 2),
        // 背景：实体节点基色（跨主题统一，作为编辑器独立控件底色；焦点在编辑器而非节点）
        background: token.color.entityFill,
        // 文字：节点文本色
        color: token.color.text,
        // 字体 / 字号 / 字重
        fontFamily: token.font.family,
        fontSize,
        fontWeight,
        lineHeight: `${lineHeight}px`,
        // 垂直居中（lineHeight = h 让浏览器自动 baseline 居中）
        padding: `0 ${padX}px`,
        // 选中描边：selection 令牌色 + 1.5px 按 k 缩放
        border: `${borderW}px solid ${token.color.selection}`,
        outline: 'none',
        // 柔和焦点阴影：外发光 + 内陷（玻璃气质「按下去」感）
        boxShadow: `0 0 ${shadowBlur}px ${token.color.selection}55, inset 0 ${insetBlur}px ${insetBlur * 2}px rgba(0,0,0,0.35)`,
        // 输入框内文字"无感全选"：caret 用 selection 色
        caretColor: token.color.selection,
      }}
    />
  );
}
