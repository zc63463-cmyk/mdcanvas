/**
 * AssetPanel —— 笔记图库侧栏（右侧玻璃浮层，与 OutlinePanel 同构）。
 * 资产清单经宿主注入（P0）；大图集窗口化渲染（P3：虚拟滚动，固定行高 + 可视区间裁剪）；
 * 缩略图可选（resolve prop，宿主解析 URL）；失效项 warn 标识 + 禁插（P2）。
 * 点击资产 → onInsert（宿主负责插入 @img/@draw 引用）；空态引导。
 * 上传入口（P1-1）：「+ 上传」按钮（file input）+ 面板拖拽 → onUpload(files)；
 * 未传 onUpload 时按钮不渲染（既有只读用法零破坏）。
 */
import { useEffect, useRef, useState } from 'react';
import { CHROME } from '../theme/tokens.js';

export interface AssetItem {
  kind: 'img' | 'draw';
  id: string;
  name: string;
  type: string;
}

export interface AssetPanelProps {
  assets: AssetItem[];
  onInsert: (item: AssetItem) => void;
  onClose: () => void;
  /** 失效判定（P2）：宿主同步判定清单项不可加载 → warn 标识 + 禁止插入 */
  isMissing?: (item: AssetItem) => boolean;
  /** 缩略图 URL 解析（P3）：宿主 resolveAsset；缺省不渲染缩略图 */
  resolve?: (item: AssetItem) => string;
  /** 上传入口（P1-1）：上传按钮 / 面板拖拽 → 文件数组（宿主负责过滤 + uploadAsset） */
  onUpload?: (files: File[]) => void;
}

/** 虚拟滚动行高（px）：项 + 2px 间距（与渲染样式一致） */
const ROW_H = 30;
/** 可视区上下缓冲行数（防快速滚动闪白） */
const BUFFER = 6;

export function AssetPanel({ assets, onInsert, onClose, isMissing, resolve, onUpload }: AssetPanelProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [range, setRange] = useState({ start: 0, end: Math.min(assets.length, 30) });
  const viewHRef = useRef(400);

  // 虚拟区间：按滚动位置裁剪（窗口化——大图集只渲染可视项，O(可视) DOM）
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = (): void => {
      const viewH = el.clientHeight || viewHRef.current;
      viewHRef.current = viewH;
      const start = Math.max(0, Math.floor(el.scrollTop / ROW_H) - BUFFER);
      const end = Math.min(assets.length, Math.ceil((el.scrollTop + viewH) / ROW_H) + BUFFER);
      setRange({ start, end });
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    return () => el.removeEventListener('scroll', update);
  }, [assets.length]);

  return (
    <div
      data-asset-panel
      style={{
        position: 'absolute',
        right: 18,
        top: 76,
        width: 230,
        maxHeight: '60vh',
        display: 'flex',
        flexDirection: 'column',
        background: CHROME.panelBg,
        border: `1px solid ${CHROME.panelBorder}`,
        borderRadius: CHROME.radius,
        boxShadow: CHROME.shadow,
        backdropFilter: 'blur(14px) saturate(1.3)',
        color: CHROME.text,
        fontFamily: CHROME.fontFamily,
        padding: 8,
        zIndex: 4,
      }}
      // P1-1 面板拖拽上传：dragover 阻止默认以允许 drop；drop 透传文件列表
      onDragOver={(e) => {
        if (!onUpload || !e.dataTransfer?.types.includes('Files')) return;
        e.preventDefault();
      }}
      onDrop={(e) => {
        if (!onUpload) return;
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (files.length === 0) return;
        e.preventDefault();
        onUpload(files);
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '2px 6px 8px',
          flex: 'none',
        }}
      >
        <span style={{ color: CHROME.neon, fontWeight: 600, fontSize: CHROME.fontSize }}>图库</span>
        {onUpload && (
          <span
            data-asset-upload
            onClick={() => fileInputRef.current?.click()}
            style={{
              color: CHROME.neon,
              cursor: 'pointer',
              fontSize: CHROME.fontSizeSmall,
              padding: '1px 6px',
              borderRadius: 6,
              border: `1px solid ${CHROME.panelBorder}`,
            }}
          >
            + 上传
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span
          data-asset-close
          onClick={onClose}
          style={{ color: CHROME.textMuted, cursor: 'pointer', fontSize: CHROME.fontSize }}
        >
          ×
        </span>
      </div>
      {assets.length === 0 ? (
        <div
          style={{ color: CHROME.textMuted, fontSize: CHROME.fontSizeSmall, padding: '8px 6px' }}
        >
          {onUpload
            ? '暂无资产。点击上方「+ 上传」选择图片，或将图片拖到这里 / 画布。'
            : '暂无资产。'}
        </div>
      ) : (
        <div
          ref={scrollerRef}
          data-asset-scroller
          style={{ overflowY: 'auto', flex: 1, maxHeight: 'calc(60vh - 44px)' }}
        >
          <div style={{ height: assets.length * ROW_H, position: 'relative' }}>
            {assets.slice(range.start, range.end).map((a, i) => {
              const missing = isMissing?.(a) ?? false;
              const top = (range.start + i) * ROW_H;
              return (
                <div
                  key={`${a.kind}:${a.id}`}
                  data-asset-item
                  data-missing={missing || undefined}
                  onClick={() => {
                    if (missing) return; // 失效项禁止插入
                    onInsert(a);
                  }}
                  style={{
                    position: 'absolute',
                    top,
                    left: 0,
                    right: 0,
                    height: ROW_H - 2,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '0 6px',
                    borderRadius: 6,
                    cursor: missing ? 'not-allowed' : 'pointer',
                    opacity: missing ? 0.55 : 1,
                  }}
                >
                  {resolve && !missing && <Thumb src={resolve(a)} name={a.name} />}
                  <span
                    style={{
                      fontSize: CHROME.fontSizeSmall,
                      color: missing
                        ? CHROME.warn
                        : a.kind === 'img'
                          ? CHROME.neon
                          : CHROME.textMuted,
                      fontWeight: 600,
                      width: 30,
                      flex: 'none',
                    }}
                  >
                    {a.kind}
                  </span>
                  <span
                    style={{
                      fontSize: CHROME.fontSizeSmall,
                      color: missing ? CHROME.warn : undefined,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                    }}
                  >
                    {a.name}
                    {missing ? '（失效）' : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {/* P1-1 隐藏 file input：上传按钮的唯一数据源；change 后清空 value 以支持重复选同一文件 */}
      {onUpload && (
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.svg"
          style={{ display: 'none' }}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) onUpload(files);
            e.target.value = '';
          }}
        />
      )}
    </div>
  );
}

/** 缩略图（P3）：固定 32×22 裁剪；加载失败自动隐藏 */
function Thumb({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (failed) return null;
  return (
    <img
      src={src}
      alt={name}
      width={32}
      height={22}
      style={{ objectFit: 'cover', borderRadius: 4, flex: 'none', display: 'block' }}
      onError={() => setFailed(true)}
    />
  );
}
