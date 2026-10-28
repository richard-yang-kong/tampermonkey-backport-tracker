# Backport Tracker Userscript — 功能与实现总结

文件：`~/Downloads/backport-tracker.user.js`
运行环境：Tampermonkey，匹配 `https://github.com/*/*/pull/*`

---

## 一、整体功能

在 GitHub PR 页面的 sidebar 顶部注入一个 **Backports** 或 **Original PR** 区块，展示当前 PR 的所有 backport 情况，并提供一键复制摘要的功能。

根据当前页面是"主 PR"还是"backport PR"，区块有两种模式：

| 页面类型 | 区块标题 | 展示内容 |
|---|---|---|
| 主 PR（合入到 `next`/`main` 等）| **Backports** | 所有 backport 子 PR 的状态 |
| Backport PR | **Original PR** | 被 backport 的原始 PR |

---

## 二、判断"是否为 Backport PR"

`isBackportPrCandidate({ title, headBranch, baseBranch })` 满足以下任一条件即视为 backport PR：

1. **PR 标题**包含 `backport`（不区分大小写）
2. **head branch**（发起 PR 的源分支）名包含 `backport`
3. **base branch**（PR 的目标分支）以 `next/` 开头，或等于 `ai-master`

---

## 三、Backport PR 收集策略（三路来源）

扫描当前主 PR 页面，通过以下三个来源收集候选 backport PR，最终只接受自身满足 backport 判定的 PR：

### 来源 1：评论区
- 遍历所有评论块，筛选内容含 `backport` 的评论
- 从评论文本中提取 "backport to X" / "backport PR for X" 格式的目标分支名
- 收集评论里的所有 PR 链接，附上分支 hint

### 来源 2：Timeline 事件
- 遍历所有 `mentioned this` / `referenced this` 类型的 timeline 事件
- 只处理事件文本中包含 `backport` 的条目
- 收集事件内的 PR 链接

### 来源 3：页面上任意带 `[backport -> branch]` 格式标题的 PR 链接
- 覆盖 collapsed timeline 等 Source 2 漏掉的 bot 发布链接

### 最终过滤
候选 PR 被收集后，会发起 fetch 获取其自身页面，提取真实的 title / head branch / base branch，只有通过 `isBackportPrCandidate` 判定的 PR 才真正入表。

### 兜底：GitHub PR 搜索
同时对 `/{repo}/pulls?q=is:pr {prNumber}` 发起搜索请求（open/merged/closed 各一条），补充 timeline 被翻页折叠时漏掉的 backport PR。

---

## 四、CI 状态分类

对每个 open 状态的 backport PR，调用 `/page_data/status_checks` 接口获取 CI checks，然后按以下优先级设置 `ciStatus`：

| 优先级 | 条件 | ciStatus | 含义 |
|---|---|---|---|
| 1 | 普通测试有失败 | `test_fail` | 测试失败 |
| 2 | 有普通测试还在运行 | `pending` | 测试进行中 |
| 3 | 所有普通测试结束，且存在 manager approval check 但尚未 Approved | `ma_pending` | 等待 MA |
| 4 | 所有普通测试结束，且 manager approval 已 Approved 或根本不存在该 check | `success` | 全部通过 |

**注意**：manager approval 的非 Approved 状态（包括 `ACTION_REQUIRED`）统一归到 `ma_pending`，对外显示为 `WAITING MA`。如果压根没有 manager approval check，则不会再误报为 pending，而是和其他 checks 一起按通过处理。

---

## 五、PR 状态优先级（多 PR 同分支时）

同一个目标分支可能存在多个候选 PR，`shouldReplaceBranchEntry` 按以下顺序选最优：

1. 同一个 PR（相同 PR number）→ 允许覆盖（用于状态回填，解决 CLOSED 条目不更新的 bug）
2. 状态 rank 更高的优先：`MERGED(3) > OPEN(2) > CLOSED(1)`
3. 同 rank 时取 PR number 更大（更新）的

---

## 六、UI 渲染

每条 backport PR 显示为一行：

- 左侧：`#<number> <branch名>` 的可点击链接
- 右侧：状态 badge + 图标：

| ciStatus | 图标 | 颜色 |
|---|---|---|
| `fetching` | `LOADING` + 转动的 sync 图标 | 灰色 |
| `test_fail` | `FAIL` + ✕（点击弹出失败 checks 列表，可跳转 CI 结果，并可 Re-run failed jobs） | 红色 |
| `ma_pending` | `WAITING MA` + 盾牌 | 黄色 |
| `success` | `PASS` + ✓ | 绿色 |
| `pending` | `RUNNING` + 圆点 | 黄色 |
| `error` | `ERROR` + 感叹号三角 | 红色 |
| `closed` | 半透明 ✕ | — |
| `merged` | Merged 标签 + ✓ | 紫/绿 |
| `missing` | Missing 标签 | 黄色边框 |

区块底部有两个按钮：
- **Copy summary**：复制所有 backport PR 的状态摘要
- **Copy unmerged**：只复制还未 merge 的 open PR

复制格式（open PR 额外带上 approved/required 数，例如 `1/2`；required 取自 PR 的 "Review required"，取不到时默认为 2）：
```
{PR 标题}
[STATUS] branch (approved/required): https://github.com/.../pull/...
[MERGED] branch: https://github.com/.../pull/...
```

open PR 的状态文案统一为：`FAIL` / `RUNNING` / `WAITING MA` / `PASS`。

---

## 七、生命周期与稳定性机制

| 机制 | 作用 |
|---|---|
| `MutationObserver` (domObserver) | 等待 sidebar 出现后再注入区块，无需固定延迟 |
| `MutationObserver` (sidebarObserver) | 监听 sidebar 子节点变化，React 重渲染后自动恢复区块 |
| `needsSectionRestore` 标志 | 避免 observer 触发时重复注入 |
| `shouldKeepRenderedList` | 侧边栏恢复时沿用已有列表，不重置为 loading 状态 |
| 5 秒 safety-net poll | 兜底检测主 PR 是否已 merge |
| Turbo/pjax/popstate 事件 | SPA 路由切换时触发重新扫描 |
| hovercard fallback | GitHub React 新 UI 不再内嵌 `baseRefName` 时，通过 hovercard API 获取分支信息 |
| `hovercardFetched` 标志 | URL 未变化时防止重复发起 hovercard 请求 |
| `isScanning` 锁 | 防止并发扫描 |
