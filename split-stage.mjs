// P2-2: StageInner 拆分（ADR-0007）—— 一次性脚本，执行后删除
import { readFileSync, writeFileSync } from 'node:fs';

const P = 'apps/canvas/src/MindmapStage.tsx';
const L = readFileSync(P, 'utf8').split(/\r?\n/);

// ── 区段切分（1-based 行号 → 0-based 索引）──────────────────
const head = L.slice(0, 106); // L1–L106（含 imports）
const outer = L.slice(106, 175); // L107–L175：StageInner 前半（7 个安全 Hook）
const inner = L.slice(176, 1550); // L177–L1550：搬迁内容（21 个 Hook + JSX）
const tail = L.slice(1551); // L1552–end：空行 + 注释 + DocBtn + MindmapStage

// ── 1. 扩 React 类型导入（L7）──────────────────────────────
head[6] =
  "import {\n" +
  '  useCallback,\n  useEffect,\n  useMemo,\n  useRef,\n  useState,\n' +
  '  type CSSProperties,\n  type Dispatch,\n  type RefObject,\n  type SetStateAction,\n' +
  "} from 'react';";

// ── 2. StageInner 尾部：早退降级 UI + 渲染 StageContent ──────
const PROPS = [
  'token',
  'stats',
  'setStats',
  'pluginActive',
  'apiRef',
  'docHost',
  'doc',
  'setDoc',
  'docMenuOpen',
  'setDocMenuOpen',
  'fileInputRef',
  'data',
  'editable',
  'refs',
  'entities',
  'setEntities',
  'controllerRef',
  'controller',
];

const stageInnerTail = [
  '',
  '  // 解析失败降级：controller 为 null 说明数据管线解析失败（editable 为 null）。',
  '  // 此早退位于本组件全部 Hook 之后，Hook 调用数恒定 —— 符合 React Hooks 规则（ADR-0007）。',
  '  // 渲染层 StageContent 接收非 null 的 controller，其内 21 个 Hook 得以无条件调用。',
  '  if (!controller) {',
  '    return (',
  "      <div",
  '        style={{',
  "          position: 'absolute',",
  '          inset: 0,',
  "          display: 'grid',",
  "          placeItems: 'center',",
  '          color: CHROME.text,',
  '          fontFamily: CHROME.fontFamily,',
  '        }}',
  '      >',
  "        <div style={{ textAlign: 'center' }}>",
  "          <div style={{ fontSize: 15, marginBottom: 8 }}>文档解析失败</div>",
  '          <div style={{ fontSize: 12, color: CHROME.textMuted }}>',
  '            {doc.name} 无法解析为可编辑树，请检查 .mm.md 语法。',
  '          </div>',
  '        </div>',
  '      </div>',
  '    );',
  '  }',
  '',
  '  return (',
  '    <StageContent',
  ...PROPS.map((p) => `      ${p}={${p}}`),
  '    />',
  '  );',
  '}',
];

// ── 3. StageContent 组件定义 ────────────────────────────────
const contentHead = [
  '',
  '/** 数据管线的返回形态（避免引入新导入） */',
  'type EditableData = ReturnType<typeof buildEditable>;',
  '',
  'interface StageContentProps {',
  '  token: ReturnType<typeof useTheme>[\'token\'];',
  '  stats: MapStats | null;',
  '  setStats: Dispatch<SetStateAction<MapStats | null>>;',
  '  pluginActive: boolean;',
  '  apiRef: RefObject<MapViewApi | null>;',
  '  docHost: DocumentHost;',
  '  doc: MindDoc;',
  '  setDoc: Dispatch<SetStateAction<MindDoc>>;',
  '  docMenuOpen: boolean;',
  '  setDocMenuOpen: Dispatch<SetStateAction<boolean>>;',
  '  fileInputRef: RefObject<HTMLInputElement | null>;',
  '  data: EditableData;',
  '  editable: EditableData[\'editable\'];',
  '  refs: EditableData[\'refs\'];',
  '  entities: Map<string, Entity>;',
  '  setEntities: Dispatch<SetStateAction<Map<string, Entity>>>;',
  '  controllerRef: RefObject<EditorController | null>;',
  '  /** 非 null —— 由 StageInner 早退保证 */',
  '  controller: EditorController;',
  '}',
  '',
  '/**',
  ' * StageContent —— 渲染层（ADR-0007）。',
  ' *',
  ' * 从 StageInner 拆出：接收**非 null** 的 controller，其后所有 Hook 无条件调用，',
  ' * 消除原先「早退位于 Hook 中间」导致的 21 处 useHookAtTopLevel 违规。',
  ' * 本组件内仍保留 `if (!layout) return null`，但它位于全部 Hook 之后（合规）。',
  ' */',
  'function StageContent({',
  ...PROPS.map((p) => `  ${p},`),
  '}: StageContentProps) {',
];

// ── 组装 ───────────────────────────────────────────────────
const out = [...head, ...outer, ...stageInnerTail, ...contentHead, ...inner, '}', ...tail];

writeFileSync(P, out.join('\n'), 'utf8');
console.log('重构完成');
console.log('  原行数:', L.length);
console.log('  新行数:', out.length);
console.log('  StageContent 搬迁行数:', inner.length);
