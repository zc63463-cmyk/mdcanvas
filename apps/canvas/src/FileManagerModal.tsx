/**
 * 文件管理器模态层（从 `MindmapStage` 抽出，T1 结构治理续）。
 *
 * 两件事合在这里：
 * ① 半透明遮罩 + 居中容器（点击遮罩关闭，内层拦截冒泡）
 * ② **打开策略**：条目有源码快照 → 走 applyDoc（带未保存守卫）；
 *    只剩元数据（旧条目被配额剥掉 source）→ 走「重新选文件」。
 *
 * 为什么策略也放进来：它是"从文件管理器打开文档"的完整语义，放主函数里
 * 会让文件管理的逻辑再次分裂到两处（上一轮拆边时就吃过这个亏）。
 *
 * 不是什么：不含目录树渲染与增删改（`FileManager.tsx` 自己管），
 * 也不含持久化（`DocLibrary` 管）。
 */
import type { DocEntry, DocLibrary, MindDoc } from '@mindcanvas/react';
import { FileManager } from './FileManager.js';

export interface FileManagerModalProps {
  library: DocLibrary;
  /**
   * 切换到某文档；**返回是否真的切换了**。
   * 用户若在未保存确认框点「取消」则返回 false —— 此时保持浮层打开，
   * 否则会出现「界面关了但文档没换」的观感。
   */
  applyDoc: (doc: MindDoc) => Promise<boolean>;
  /** 条目无源码快照时：让用户重新选文件（内部同样经守卫） */
  handleOpen: () => Promise<void>;
  /** 新建文档 */
  handleNew: () => void;
  onClose: () => void;
}

export function FileManagerModal({
  library,
  applyDoc,
  handleOpen,
  handleNew,
  onClose,
}: FileManagerModalProps) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 60,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(0,0,0,.45)',
      }}
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()}>
        <FileManager
          library={library}
          onOpen={async (entry: DocEntry) => {
            // 只剩元数据（靠前的旧条目，source 已被配额剥掉）→ 重新选文件。
            // 这条路径同样可能丢弃未保存修改，所以走 handleOpen
            // （内部经 applyDoc 守卫），而不是直接换 doc。
            if (entry.source === undefined) {
              onClose();
              void handleOpen();
              return;
            }
            // 有源码快照 → 经 applyDoc 切换（有未保存修改时弹确认）。
            // 此前这里直接 setDoc，绕过了守卫 → 静默丢弃未保存修改。
            const switched = await applyDoc({
              id: entry.id,
              name: entry.name,
              source: entry.source,
              saved: true,
              ts: entry.ts,
            });
            if (switched) onClose();
          }}
          onCreate={() => {
            onClose();
            handleNew();
          }}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
