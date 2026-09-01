/**
 * EdgeLabel —— 边关系标签「线中生长」（E8）。
 * 蒋指导反馈①：原来的胶囊标签「太大且感觉设计不好」，要求字更小、且是「从线中生长出来的」。
 *
 * 形态：触点（线上的小圆点 bud）+ 短茎（stem）+ 小胶囊（pill）。
 * - 字号 10（原 11）、胶囊高 14（原 18）——面积约为原来的 45%
 * - 胶囊沿连线法向外推 stem+半高，线本身不被遮挡（箭头方向仍可读）
 * - 纯函数可测（宽度估算不依赖 DOM 测量）
 */
import type { TokenSet } from '../theme/types.js';

/** 标签字号（极小——蒋指导反馈：「字小一点，在线中生长」） */
export const EDGE_LABEL_FONT = 9;
/** 胶囊高度（紧凑） */
export const EDGE_LABEL_H = 11;
/** 胶囊左右内边距 */
const PILL_PAD = 4;
/** 短茎长度（从连线到胶囊近边；更短→更贴近线） */
const STEM = 3;
/** 最小胶囊宽（空/极短文本兜底） */
const MIN_W = 14;

/** 文本宽度估算（CJK 全角 ≈ 1em，ASCII ≈ 0.56em） */
export function textWidthOf(s: string, fontSize = EDGE_LABEL_FONT): number {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 0x2e7f ? fontSize : fontSize * 0.56;
  return w;
}

/** 胶囊宽度（文本宽 + 双内边距，下限 MIN_W） */
export function pillWidthOf(text: string, fontSize = EDGE_LABEL_FONT): number {
  return Math.max(MIN_W, Math.round(textWidthOf(text, fontSize) + PILL_PAD * 2));
}

export interface EdgeLabelProps {
  /** 连线上的附着点（世界坐标） */
  ax: number;
  ay: number;
  /** 单位法向（茎的生长方向；由 normalAtMid / cubicMidNormal 提供） */
  nx: number;
  ny: number;
  /** 标签文本（空 → 不渲染） */
  text: string;
  /** 描边色（跟随关系语义色 / 用户自定义色） */
  stroke: string;
  token: TokenSet;
  /** 弱化（失效边）→ 半透明 */
  muted?: boolean;
  /** 测试/定位钩子 */
  testId?: string;
}

/** 边关系标签：触点 + 短茎 + 小胶囊 */
export function EdgeLabel({ ax, ay, nx, ny, text, stroke, token, muted, testId }: EdgeLabelProps) {
  if (text === '') return null;
  const w = pillWidthOf(text);
  const off = STEM + EDGE_LABEL_H / 2;
  const cx = ax + nx * off;
  const cy = ay + ny * off;
  return (
    <g data-edge-label={testId ?? ''} style={{ pointerEvents: 'none' }} opacity={muted ? 0.6 : 1}>
      {/* 触点：长在连线上的小芽（更小→不抢眼） */}
      <circle cx={ax} cy={ay} r={1.3} fill={stroke} opacity={0.85} />
      {/* 短茎：连接线与胶囊 */}
      <line
        x1={ax}
        y1={ay}
        x2={ax + nx * STEM}
        y2={ay + ny * STEM}
        stroke={stroke}
        strokeWidth={1}
        opacity={0.75}
      />
      <rect
        x={cx - w / 2}
        y={cy - EDGE_LABEL_H / 2}
        width={w}
        height={EDGE_LABEL_H}
        rx={EDGE_LABEL_H / 2}
        fill={token.color.canvas}
        stroke={stroke}
        strokeWidth={0.9}
        opacity={0.97}
      />
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={EDGE_LABEL_FONT}
        fill={token.color.text}
        fontFamily={token.font.family}
      >
        {text}
      </text>
    </g>
  );
}

/** 解析 `M x y C c1x c1y, c2x c2y, x y` 路径 → t=0.5 中点 + 单位法向（树边标签定位） */
export function cubicMidNormal(d: string): { x: number; y: number; nx: number; ny: number } | null {
  const m = d.match(
    /^M ([\d.-]+) ([\d.-]+) C ([\d.-]+) ([\d.-]+), ([\d.-]+) ([\d.-]+), ([\d.-]+) ([\d.-]+)$/,
  );
  if (!m) return null;
  const [sx, sy, c1x, c1y, c2x, c2y, ex, ey] = m.slice(1).map(Number) as number[];
  const p0 = { x: sx!, y: sy! };
  const p1 = { x: c1x!, y: c1y! };
  const p2 = { x: c2x!, y: c2y! };
  const p3 = { x: ex!, y: ey! };
  const mid = {
    x: 0.125 * p0.x + 0.375 * p1.x + 0.375 * p2.x + 0.125 * p3.x,
    y: 0.125 * p0.y + 0.375 * p1.y + 0.375 * p2.y + 0.125 * p3.y,
  };
  const tx = p3.x + p2.x - p1.x - p0.x;
  const ty = p3.y + p2.y - p1.y - p0.y;
  const len = Math.hypot(tx, ty) || 1;
  let nx = -ty / len;
  let ny = tx / len;
  if (ny > 0 || (Math.abs(ny) < 0.15 && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }
  return { ...mid, nx, ny };
}
