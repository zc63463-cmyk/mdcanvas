/**
 * 玻璃翻卡组件（设计报告「翻卡适配评估」交互具象化）：
 * 点击翻转 3D rotateY，正面展示摘要、背面展示详情（节点 note）。
 * 视觉：深色半透明 + 霓虹强调（CHROME 恒定）；可受控也可自持状态。
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { CHROME } from '../theme/tokens.js';

/** 翻卡动效（glass 主题 motion 气质） */
const FLIP_EASING = 'cubic-bezier(.2,.7,.3,1)';

export interface FlipCardProps {
  front: ReactNode;
  back: ReactNode;
  /** 受控翻转态（缺省自持） */
  flipped?: boolean;
  onFlip?: (flipped: boolean) => void;
  width?: number;
  height?: number;
  title?: string;
  style?: CSSProperties;
}

export function FlipCard({
  front,
  back,
  flipped: contrl,
  onFlip,
  width,
  height,
  title,
  style,
}: FlipCardProps) {
  const [self, setSelf] = useState(false);
  const isFlipped = contrl ?? self;
  const set = (v: boolean) => {
    if (contrl === undefined) setSelf(v);
    onFlip?.(v);
  };
  const face: CSSProperties = {
    position: 'absolute',
    inset: 0,
    backfaceVisibility: 'hidden',
    WebkitBackfaceVisibility: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    borderRadius: CHROME.radiusSmall,
    overflow: 'hidden',
    border: `1px solid ${CHROME.panelBorder}`,
    background: CHROME.panelBg,
    boxShadow: CHROME.shadow,
    transition: `transform 0.45s ${FLIP_EASING}`,
  };
  return (
    <div
      role="button"
      aria-pressed={isFlipped}
      aria-label={title}
      onClick={() => set(!isFlipped)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          set(!isFlipped);
        }
      }}
      style={{
        width,
        height,
        perspective: 900,
        cursor: 'pointer',
        ...style,
      }}
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          transformStyle: 'preserve-3d',
        }}
      >
        <div style={{ ...face, transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}>
          {front}
        </div>
        <div
          style={{
            ...face,
            transform: isFlipped ? 'rotateY(0deg)' : 'rotateY(-180deg)',
            borderColor: CHROME.neon,
          }}
        >
          {back}
        </div>
      </div>
    </div>
  );
}
