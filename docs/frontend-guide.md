# 前端开发规范（React 18 / Vite / Tailwind）

> 适用于 `slicer-labeler/frontend`。本文档重点是**「并发竞态与异步状态管理」**——
> 本项目的标注页、波形播放、SSE 任务流、弹窗预览等都涉及多段异步链，
> 过去在做页面 feature 与动画时已踩过不少竞态坑，现将已验证的正确模式固化为规范。
>
> **给 AI 的要求：开发任何涉及异步、定时器、动画、播放的前端功能前，必须先通读第 3 节。**

## 1. 技术栈与目录

- React 18 · Vite 5 · Tailwind CSS · framer-motion · react-router v6 · lucide-react
- `src/pages/`：页面（LabelPage 标注页、DatasetListPage、ModelListPage、AdminPage、LoginPage）
- `src/components/`：标注行 ItemRow、波形播放器 WavePlayer、弹窗（Split/Merge/Delete/Import）、设置面板、布局
- `src/context/`：AuthContext（会话）、TaskContext（SSE 任务流）
- `src/utils/api.js`：统一请求封装（禁止在组件里裸 fetch 业务接口）

## 2. 请求与数据获取约定

- 所有业务请求走 `src/utils/api.js`（自动带 token、401 全局登出、统一错误抛出）。**不要**在组件里直接 `fetch('/api/...')`。
- 新增接口：在 api.js 加导出函数（命名 `getXxx` / `setXxx` / `deleteXxx`），保持与后端路径一致。
- SSE：`subscribeTasks` / `subscribeTask` 封装了 EventSource（token 走 `?token=`、终态自动 close、自动重连）。任务流事件通过 `TaskContext` 消费，组件不要直接 new EventSource。
- 分片上传（64MB）：api.js 的 `importDataset` 已处理按序串行与进度折算，前端业务侧只回调进度。

## 3. 并发竞态与异步状态管理（重点专章）

> 本项目的铁律。每一条都对应一个真实踩坑场景，遵循「标准写法」。

### 3.1 异步回调读状态：ref + state 双份（可变缓存镜像）

**问题**：state 更新是异步的、闭包捕获旧值。timer 回调、`await` 之后、Promise.all 内部需要读到**最新**的 entries / settings。

**标准写法**（参照 `LabelPage.jsx`）：

```jsx
const [entries, setEntries] = useState([]);       // 渲染数据
const entriesRef = useRef([]);                     // 可变镜像
useEffect(() => { entriesRef.current = entries; }, [entries]);  // state→ref 兜底
// 更关键：setState updater 内同步 ref，异步链无需等渲染
setEntries((prev) => {
  const next = prev.slice();
  next[i] = entry;
  entriesRef.current = next;   // ← 立即同步
  return next;
});
```

**规则**：凡是被「异步回调（timer/await/SSE）」读取的 state，一律配一个 ref 镜像；在 updater 内同步，而不是依赖单独的 `useEffect`（后者会慢一帧）。

### 3.2 async 中途失效检查：await 后复查

**问题**：自动播放是「倒计时 → 播 → 下一跳」异步链，用户随时可能停止/跳页/编辑，`await` 返回后世界已经变了。

**标准写法**（参照 `LabelPage.jsx` scheduleNext / handleAudioEnded）：

```js
if (!entriesRef.current[nextIdx]) {
  await ensurePageLoaded(page);
  if (!autoPlayEnabledRef.current) return;   // ← await 之后必须复查开关
}
// ... 继续
await markPageVerified(page, true);
if (!autoPlayEnabledRef.current) return;     // ← 每个 await 后复查
```

**规则**：每个 `await` 之后、使用其结果继续写状态/播放之前，必须检查「是否仍有效」（alive / ref 开关 / nonce）。违反这条是本项目最常见的竞态 bug。

### 3.3 慢请求防旧覆盖新：requestId / nonce 序号

**问题**：`polishMergeText`（DeepSeek）很慢，用户重试或依赖变化触发新请求后，旧响应晚到会覆盖新结果。

**标准写法**（参照 `MergeModal.jsx`）：

```jsx
const polishRequestRef = useRef(0);
const requestPolish = useCallback(async () => {
  const requestId = ++polishRequestRef.current;      // 取号
  const result = await polishMergeText(...);
  if (polishRequestRef.current !== requestId) return; // 响应到达校验号
  setPolishedText(result.polishedText || '');
}, [...]);
useEffect(() => {
  requestPolish();
  return () => { polishRequestRef.current += 1; };    // 卸载/重跑时作废旧号
}, [requestPolish]);
```

**规则**：慢请求（AI 润色、大列表、长任务）必须用序号/requestId 防旧响应覆盖；清理函数里递增序号使在途请求失效。

### 3.4 useEffect 内 fetch：alive / cancelled 标志

**问题**：请求返回时组件可能已卸载或依赖已变，setState 泄漏。

**标准写法**（参照 `LabelPage.jsx` getDataset、`ItemRow.jsx` 音频解码、`AuthContext.jsx`）：

```jsx
useEffect(() => {
  let cancelled = false;
  setAudioBuffer(null);
  fetch(url).then(r => r.arrayBuffer()).then(b => decode(b))
    .then(buf => { if (!cancelled) setAudioBuffer(buf); })  // 中途检查
    .catch(() => {});
  return () => { cancelled = true; };
}, [entry.wavPath]);
```

**规则**：凡是 effect 里发起的异步（fetch/解码/订阅），cleanup 里置 `alive=false`/`cancelled=true`，`.then` 回调前先检查。

### 3.5 定时器与 RAF：先清后设 + 卸载统一清理

**问题**：前一个高亮/倒计时 timer 未清，会提前熄灭或覆盖新的；组件卸载后回调 setState 泄漏。

**标准写法**（参照 `LabelPage.jsx` highlightItems、WavePlayer.jsx RAF）：

```jsx
const highlightItems = useCallback((indices, durationMs = 1400) => {
  if (highlightTimerRef.current) { clearTimeout(highlightTimerRef.current); highlightTimerRef.current = null; } // 先清后设
  setHighlightIndices(valid);
  highlightTimerRef.current = setTimeout(() => { setHighlightIndices([]); highlightTimerRef.current = null; }, durationMs);
}, []);

// 卸载 cleanup 统一清理全部 timer/RAF/流
useEffect(() => () => {
  clearAutoTimers();
  if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
  cancelAnimationFrame(rafRef.current);
}, [clearAutoTimers]);
```

**规则**：
- 设置任何 interval/timeout/RAF 前先 `clearInterval`/`clearTimeout` 旧句柄（**反例：`SplitModal.jsx` 的预览段轮询 interval 未清，切换段或卸载会残留**）。
- 组件卸载 cleanup 必须清掉所有 timer/RAF/EventSource/source 节点。
- 依赖 `Date.now()` 算倒计时（`beginAutoPlayItem` 每 50ms），不要在 interval 里依赖 state 闭包自增。

### 3.6 播放/指令广播：nonce 信号 + 幂等消费

**问题**：`playSignal`/`stopSignal` 广播给所有 ItemRow，且 React 18 StrictMode 双渲染或重复 set 会二次触发播放/停止。

**标准写法**（参照 `WavePlayer.jsx`）：

```jsx
const lastNonceRef = useRef(0);
useEffect(() => {
  const nonce = playSignal?.nonce ?? 0;
  if (playSignal?.targetIdx !== index) return;            // 只响应目标行
  if (nonce > 0 && nonce !== lastNonceRef.current) {      // 同一 nonce 只消费一次
    lastNonceRef.current = nonce;
    audioRef.current?.play().catch(() => {});
  }
}, [playSignal, index]);
```

**规则**：跨组件指令用 `{ nonce, targetIdx }` 结构；消费端「目标匹配 + nonce 幂等」双重校验。

### 3.7 列表结构变更（切分/合并/删除）后的缓存失效

**问题**：entries 是稀疏分页缓存，切分/合并/删除改变 total 与全局索引，旧缓存会产生幽灵条目/索引错位。

**标准写法**（参照 `LabelPage.jsx` handleSplitComplete）：

```jsx
if (autoPlayEnabledRef.current) stopAutoPlayByUser(...); // 先停播放
setTotal(newTotal);               // 先改 total
setCheckedIndices({});
await resetEntriesCache(currentPage);  // 清 loadedPagesRef + 重载当前页
focusItemsAfterListChange(...);        // 延时滚动+高亮
```

**规则**：任何改变条目集合的操作：先停自动播放 → 同步 total → 重置缓存 → 重新加载 → 延时聚焦。

### 3.8 渲染后 DOM 操作：setTimeout 延后

**问题**：`setCurrentPage` 后 DOM 尚未渲染新页，立即 `querySelector` 找不到目标。

**标准写法**（参照 `LabelPage.jsx` scrollToItem）：

```jsx
setCurrentPage(page);
ensurePageLoaded(page);
setTimeout(() => {  // 等 React 提交渲染后再操作 DOM
  const targetRow = Array.from(document.querySelectorAll('.item-row')).find(...);
  targetRow?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}, 150);
```

**规则**：setState 之后立即操作新 DOM 一律延后；`scrollIntoView` 等用 setTimeout（150ms 级）。

### 3.9 SSE / EventSource：Map 去重 + 全量关闭

**问题**：任务流是「主流 + 每任务子流」，重复订阅同一任务、卸载泄漏连接、事件到达时已卸载。

**标准写法**（参照 `TaskContext.jsx`）：

```jsx
const streamsRef = useRef(new Map());
const attachStream = (taskId) => {
  if (streamsRef.current.has(taskId)) return;   // 按 taskId 去重
  const es = subscribeTask(taskId, { onEvent: (ev) => { if (!alive) return; setTasks(...); } });
  streamsRef.current.set(taskId, es);
};
return () => {                                   // 卸载
  alive = false;
  es.close();
  streamsRef.current.forEach((s) => s.close());
  streamsRef.current.clear();
};
```

**规则**：SSE 一律走 TaskContext；订阅去重；卸载先置 alive=false 再关全部流。

### 3.10 WebAudio / 预览播放：残留节点防叠加

**问题**：重复点预览/暂停会叠加 source 节点（回声/叠音），RAF 显示循环也叠加。

**标准写法**（参照 `MergeModal.jsx`）：

```js
sourcesRef.current.forEach((s) => { try { s.stop(); } catch (_) {} });  // 开始前清残留
sourcesRef.current = [];
```

**规则**：WebAudio 每次播放前 stop 所有残留 source；暂停用 stop 而非 suspend ctx。

### 3.11 现有待整改的反例（新代码不要学）

| 文件 | 问题 | 整改方向 |
|---|---|---|
| `SplitModal.jsx` L83-89 | 预览段 interval 未 clear、`audio.onended` 直接赋值覆盖 | 先清后设；用 `addEventListener` 或 ref 管理句柄 |
| `LoginPage.jsx` / `DatasetListPage.jsx` / `ModelListPage.jsx` / `LabelPage.jsx` loadData | mount 时 fetch 无 alive 标志 | 按 §3.4 加 alive/cancelled |

## 4. 动画与视觉效果

- 页面级进出场：`AnimatePresence mode="popLayout"` + `key={location.pathname}`（`AppLayout.jsx`），退出元素脱离布局流，进入元素不被挤压。
- 列表错峰入场：`framer-motion` `delay: i * 0.04`；**动画常量提升到模块级**，避免每次渲染重建内联对象。
- 波形扫描线用 RAF 驱动，生命周期管理见 §3.5（`WavePlayer.jsx` startRAF/stopRAF/resetPlayback）。
- 优先 Tailwind 原子类 + CSS 变量主题（`var(--accent)` 等），少写魔法数字内联样式。

## 5. 状态管理约定

- 全局共享状态才放 Context（Auth、Task）；页面局部状态用 useState/useRef，**不要**随意加全局。
- 编辑类弹窗的「提交中」状态用 phase 状态机（`ImportModal.jsx` 的 `idle→uploading→processing→done/error` 单向流转），上传/处理中禁止关闭与重复提交。
- 单行操作锁用 `busyId`（`AdminPage.jsx`）：不同用户可并行、同一行禁止并发。

## 6. 开发命令

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173，/api 代理到 http://localhost:8080
npm run build    # 产物 dist/（Cloudflare Pages 自动发布）
```

## 7. 提交流程提醒

- 前端改动只提交 `frontend/**` 相关文件；推 `main` 后由 Cloudflare Pages 自动构建，**不会**触发后端 workflow（已按路径隔离）。
- 涉及并发/播放/动画的改动，先对照第 3 节自查一遍再提交。
