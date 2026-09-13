/**
 * 边健康度纯函数（R0 观测先行：把「边坏了但静默」变成可计数、可看见、可定位）。
 *
 * 口径声明：
 * - malformed 判定复用 collectFreeEdges 的丢弃谓词（「该下标未被产出」即畸形：
 *   非对象 / from|to 非 string），不复刻第二套判定——两套口径必然漂移。
 * - renderable / noBox 是【数据层口径】（无 layout，不假装与画布等价）。
 *   与画布 freeEdgeEndpoints（freeEdges.ts:391-417）逐情形对照（R2-4 写准）：
 *   · 源锚不可解析 → 画布不画，本函数也不计 renderable（一致）
 *   · 靶锚不可解析 → 画布以 ghost 合成盒绘制，本函数计入 renderable（一致；
 *     由 edge-health.test 的 renderable=6 断言钉死，1/2 号病例即 ghost）
 *   · 数据自关联（from === to 或两端解析到同一节点）→ 画布零长退化不画，
 *     本函数排除（一致）
 *   · 端点盒缺失 / 折叠塌陷 / 零尺寸盒 → 画布 renderable:false，本函数无
 *     layout 判不了 → renderable 相对画布【只会高估、不会低估】
 * - noBox = 任一端点锚不可解析到节点（数据层「必然无盒」的子集）；【含 ghost
 *   场景】——ghost 在画布会被合成盒绘制，此计数仅表示该端在数据层未解析，
 *   与画布「无布局盒」不是同一口径。
 * - malformed 项被 collectFreeEdges 静默丢弃 → 其 state 恒 'stale'（与
 *   resolveAnchorToId「锚不可解析 → stale」契约一致），但不计入 byState
 *   （byState 只统计管线实际处理的项），由 malformed 单独计数。
 * 纯函数无 DOM；诊断条与关系面板按各自语义消费（R0-A1：不并入 allDiags）。
 */
import type { EditableNode } from '@mindcanvas/kernel';
import { defaultRelationSchema } from '../chrome/relationSchema.js';
import { collectFreeEdges, type FreeEdge } from './freeEdges.js';

/** 单条边病例明细（index 与 FreeEdge.key = `e${index}`、root.note.edges 下标对齐） */
export interface EdgeHealthItem {
  index: number;
  /** 原始锚文本（malformed 项不可信 → ''） */
  from: string;
  to: string;
  state: 'well-formed' | 'dangling' | 'stale';
  /** invalidAt 存在（软失效，恢复即清空；非锚问题） */
  invalid: boolean;
  /** 原始项非法（collectFreeEdges 会静默丢弃） */
  malformed?: boolean;
  /** 数据自关联（from === to 或两端解析到同一节点 → 画布不画） */
  selfAnchor?: boolean;
  /** 任一端点锚不可解析（数据层口径；【含 ghost 场景】——画布为 ghost 合成盒
   *  仍绘制，此处仅表示该端数据层未解析，见文件头） */
  noBox?: boolean;
  /** rel 不在 relationSchema（提示用，不算错） */
  unknownRel?: boolean;
  /** 同 from+to+rel 的前一条下标（与 findDuplicateEdge 口径一致） */
  duplicateOf?: number;
}

export interface EdgeHealth {
  /** 原始数组长度（含 malformed） */
  total: number;
  /** 数据层口径下可参与渲染的数量（ghost 计入——画布会画；布局缺盒/塌陷判不了
   *  → 相对画布只会高估，见文件头逐情形对照） */
  renderable: number;
  byState: { wellFormed: number; dangling: number; stale: number };
  invalid: number;
  malformed: number;
  selfAnchor: number;
  noBox: number;
  unknownRel: number;
  duplicates: number;
  /** 只含「非健康」项（正常边不进列表） */
  problems: readonly EdgeHealthItem[];
}

export function edgeHealthOf(root: EditableNode): EdgeHealth {
  const raw: unknown = root.note?.edges;
  const items: readonly unknown[] = Array.isArray(raw) ? raw : [];
  const free = collectFreeEdges(root);
  const byIndex = new Map<number, FreeEdge>();
  for (const e of free) byIndex.set(e.index, e);

  const byState = { wellFormed: 0, dangling: 0, stale: 0 };
  let renderable = 0;
  let invalid = 0;
  let malformed = 0;
  let selfAnchor = 0;
  let noBox = 0;
  let unknownRel = 0;
  let duplicates = 0;
  const problems: EdgeHealthItem[] = [];
  // from+to+rel → 首次出现下标（findDuplicateEdge 取首个同键边的口径）
  const seen = new Map<string, number>();

  items.forEach((_, index) => {
    const fe = byIndex.get(index);
    if (fe === undefined) {
      malformed += 1;
      problems.push({ index, from: '', to: '', state: 'stale', invalid: false, malformed: true });
      return;
    }
    if (fe.state === 'well-formed') byState.wellFormed += 1;
    else if (fe.state === 'dangling') byState.dangling += 1;
    else byState.stale += 1;

    const isInvalid = fe.invalidAt !== undefined;
    const isSelf = fe.from === fe.to || (fe.sourceId !== null && fe.sourceId === fe.targetId);
    const isNoBox = fe.sourceId === null || fe.targetId === null;
    const isUnknownRel = defaultRelationSchema.getConfig(fe.rel) === undefined;
    const dupKey = `${fe.from}\u0000${fe.to}\u0000${fe.rel}`;
    const first = seen.get(dupKey);
    if (first === undefined) seen.set(dupKey, index);

    if (isInvalid) invalid += 1;
    if (isSelf) selfAnchor += 1;
    if (isNoBox) noBox += 1;
    if (isUnknownRel) unknownRel += 1;
    if (first !== undefined) duplicates += 1;
    if (fe.sourceId !== null && fe.sourceId !== fe.targetId) renderable += 1;

    if (
      fe.state !== 'well-formed' ||
      isInvalid ||
      isSelf ||
      isNoBox ||
      isUnknownRel ||
      first !== undefined
    ) {
      const item: EdgeHealthItem = {
        index,
        from: fe.from,
        to: fe.to,
        state: fe.state,
        invalid: isInvalid,
      };
      if (isSelf) item.selfAnchor = true;
      if (isNoBox) item.noBox = true;
      if (isUnknownRel) item.unknownRel = true;
      if (first !== undefined) item.duplicateOf = first;
      problems.push(item);
    }
  });

  return {
    total: items.length,
    renderable,
    byState,
    invalid,
    malformed,
    selfAnchor,
    noBox,
    unknownRel,
    duplicates,
    problems,
  };
}
