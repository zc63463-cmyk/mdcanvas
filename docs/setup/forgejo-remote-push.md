# I1 · mindcanvas 推送 Forgejo 远端操作指南

> 状态：**待执行**（涉及凭证，由仓库所有者操作）· 风险等级：中（当前 75 commits 仅存本地单点）

## 现状

```
本地仓库：E:\Development\MyAwesomeApp\mindcanvas
分支：main · 提交数：75 · 远端：无
Forgejo 实例：http://localhost:3001 （探测 200 可达）
```

## 为什么必须做

75 个 commit（含内核 v1.0 全部成果、接口冻结、三面镜子验收）**仅存在于本机磁盘**。磁盘故障 = 全项目归零。这是当前项目中**等级最高的可消除风险**（审计 R3）。

## 执行步骤

### 步骤 1 · 在 Forgejo 创建空仓库

浏览器打开 http://localhost:3001 → 右上角 `+` → `新建仓库`：

| 项 | 值 |
|---|---|
| 仓库名称 | `mindcanvas` |
| 可见性 | 私有（个人项目建议） |
| **初始化选项** | **全部取消勾选**（不要 README / .gitignore / 许可证——本地已有，否则首次 push 冲突） |

创建后记下仓库地址，形如：`http://localhost:3001/<你的用户名>/mindcanvas.git`

### 步骤 2 · 创建访问令牌（若无）

Forgejo → `设置` → `应用` → `生成新令牌`：

| 项 | 值 |
|---|---|
| 令牌名称 | `mindcanvas-push` |
| 权限 | 勾选 `repo`（读写仓库）即可，**按最小权限原则** |

**令牌只显示一次，立即复制保存。**

### 步骤 3 · 本地关联并推送

```bash
cd E:/Development/MyAwesomeApp/mindcanvas

# 关联远端（把 <用户名> 换成你的 Forgejo 用户名）
git remote add origin http://localhost:3001/<用户名>/mindcanvas.git

# 首次推送并设置上游
git push -u origin main
```

凭证提示时：用户名 = Forgejo 用户名，密码 = **步骤 2 的令牌**（不是登录密码）。

### 步骤 4 · 验证

```bash
git remote -v                 # 应显示 origin 的两行
git log --oneline -1          # 本地最新
git ls-remote origin main     # 远端最新，两者应一致
```

浏览器刷新 Forgejo 仓库页，应看到 75 个提交与完整文件树。

## 若步骤 3 报「非空仓库冲突」

说明步骤 1 误勾选了初始化文件。两种处理：

```bash
# 方案 A（推荐）：删掉远端仓库重建，回到步骤 1
# 方案 B：先合并远端初始提交再推
git pull origin main --allow-unrelated-histories
git push -u origin main
```

## 推送后的可选增强

1. **镜像备份**：再关联一个远端（如另一块磁盘的裸仓库）做双保险
2. **自动化**：后续每个 commit 后 `git push`，或配置 post-commit hook
3. **完成 I2**：knowledge-canvas 归档（继任仓库标注）后可一并归档

## 关联文档

- 并行协作纪律（含提交规范）：`docs/collab/parallel-agent-discipline.md`
- 进度审计（R3 风险项）：`docs/roadmap/2026-08-28-progress-audit.md`
- 部署路线（R14 两阶段）：`docs/specs/2026-08-27-mindmap-forgejo-sync-design.md` §4.8
