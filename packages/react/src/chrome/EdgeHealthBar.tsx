/**
 * EdgeHealthBar（R0-2）：边健康度诊断条（R0「观测先行」的呈现端）。
 *
 * 消费 edgeHealthOf 的计数与病例明细：仅当 problems 非空时渲染；样式沿用
 * MindmapStage 中心诊断条的琥珀令牌（数据健康语义，按 R0-A1 不并入 allDiags
 * 的「解析失败」语义）；pointerEvents: 'none' 不挡画布；不做点击跳转（归 R2）。
 * 位置（bottom）由宿主传入——MindmapStage 在中心诊断条可见时抬升本条避让。
 */
import type { EdgeHealth, EdgeHealthItem } from '../render/edgeHealth.js';

/** 病例 → 单行状态标签（多标记时取最需用户处理的一个；noBox 与悬空/陈旧同因不单列） */
function labelOf(p: EdgeHealthItem): string {
  if (p.malformed) return '原始项非法';
  if (p.state === 'dangling') return '悬空';
  if (p.state === 'stale') return '陈旧';
  if (p.invalid) return '已失效';
  if (p.selfAnchor) return '自关联';
  if (p.duplicateOf !== undefined) return `与第 ${p.duplicateOf + 1} 条重复`;
  if (p.unknownRel) return '未知关系';
  return '正常';
}

export function EdgeHealthBar({ health, bottom }: { health: EdgeHealth; bottom: number }) {
  if (health.problems.length === 0) return null;
  return (
    <div
      data-edge-health-bar
      style={{
        position: 'absolute',
        left: 16,
        bottom,
        maxWidth: 420,
        padding: '8px 12px',
        borderRadius: 'var(--mc-radius, 8px)',
        background: 'rgba(186, 117, 23, 0.12)',
        border: '1px solid rgba(186, 117, 23, 0.45)',
        color: 'var(--mc-warning, #BA7517)',
        fontFamily: 'inherit',
        fontSize: 12,
        lineHeight: 1.6,
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      <div style={{ fontWeight: 600 }}>
        ⚠ 关系线诊断：{health.problems.length} 条（悬空 {health.byState.dangling} / 陈旧{' '}
        {health.byState.stale} / 失效 {health.invalid}）
      </div>
      {health.problems.slice(0, 3).map((p) => (
        <div key={p.index} data-edge-health-detail style={{ wordBreak: 'break-word' }}>
          ·{' '}
          {p.malformed
            ? `第 ${p.index + 1} 条：原始项非法`
            : `${p.from} → ${p.to}：${labelOf(p)}`}
        </div>
      ))}
      {health.problems.length > 3 && <div>… 其余 {health.problems.length - 3} 条略</div>}
    </div>
  );
}
