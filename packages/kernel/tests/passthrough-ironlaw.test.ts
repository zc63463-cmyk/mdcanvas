import { describe, expect, it } from 'vitest';
import { parseMm } from '../src/protocol/parser.js';
import { serializeMm } from '../src/protocol/serializer.js';

/**
 * 透传铁律（K1 固化）：未知值永不丢失。
 * 三个场景全部围绕「未知值 round-trip 原样保留、不报错丢弃」—— 扩展缝矩阵的底座原则
 * （spec §4.5「数据永不丢失，渲染尽力而为」），与 W-UNKNOWN-KIND / 未知 note 键透传行为对齐。
 */

describe('透传铁律：未知值永不丢失', () => {
  it('未知 kind：@futurekind:xyz 解析保留实体节点 + W-UNKNOWN-KIND，round-trip 原样保留', () => {
    const text = '# 根\n- @futurekind:xyz';
    const p1 = parseMm(text);
    expect(p1.diagnostics.map((d) => d.code)).toEqual(['W-UNKNOWN-KIND']);
    expect(p1.root?.children?.[0]).toEqual({
      type: 'entity',
      ref: { kind: 'futurekind', id: 'xyz' },
      children: [],
    });
    const p2 = parseMm(serializeMm(p1.root!));
    expect(p2.root).toEqual(p1.root);
    expect(p2.diagnostics.map((d) => d.code)).toEqual(['W-UNKNOWN-KIND']);
  });

  it('未知 note 键：ai_role / rel 列表 / 任意自定义键 round-trip 不丢不改', () => {
    const text = [
      '# 根',
      '<!--',
      'ai_role: task',
      'rel:',
      '  - @idea:forge-inbox:5',
      '自定义键: 透传值',
      '-->',
      '## 分支',
    ].join('\n');
    const p1 = parseMm(text);
    expect(p1.diagnostics).toEqual([]);
    const note = p1.root?.children?.[0]?.note;
    expect(note?.ai_role).toBe('task');
    expect(Array.isArray(note?.rel)).toBe(true);
    expect(note?.rel).toEqual(['@idea:forge-inbox:5']);
    expect(note?.['自定义键']).toBe('透传值');
    const p2 = parseMm(serializeMm(p1.root!));
    expect(p2.root).toEqual(p1.root);
    expect(p2.diagnostics).toEqual([]);
  });

  it('混合场景：未知 kind + 未知 note 键 + 已知 kind 共存 → 全量保留', () => {
    const text = [
      '# Agent Gateway',
      '<!--',
      'ai_role: task',
      '-->',
      '## 落地任务',
      '- @issue:48',
      '- @futurekind:xyz',
      '<!--',
      '自定义键: 保留',
      '-->',
      '- 文本节点',
    ].join('\n');
    const p1 = parseMm(text);
    // 仅未知 kind 产生诊断；已知 kind 与未知键零诊断
    expect(p1.diagnostics.map((d) => d.code)).toEqual(['W-UNKNOWN-KIND']);
    // 已知 kind 保留为实体节点
    expect(p1.root?.children?.[0]?.children?.[0]).toEqual({
      type: 'entity',
      ref: { kind: 'issue', id: '48' },
      children: [],
    });
    // 未知 kind 保留为实体节点
    expect(p1.root?.children?.[0]?.children?.[1]).toEqual({
      type: 'entity',
      ref: { kind: 'futurekind', id: 'xyz' },
      children: [],
    });
    // 未知 note 键保留（分支级 + 列表项级）
    expect(p1.root?.children?.[0]?.note?.ai_role).toBe('task');
    expect(p1.root?.children?.[0]?.children?.[2]?.note?.['自定义键']).toBe('保留');
    // round-trip 全量保留
    const p2 = parseMm(serializeMm(p1.root!));
    expect(p2.root).toEqual(p1.root);
    expect(p2.diagnostics.map((d) => d.code)).toEqual(['W-UNKNOWN-KIND']);
  });
});
