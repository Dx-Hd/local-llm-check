# Local LLM Check 功能与 UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不破坏现有纯静态站点功能的前提下，加入主动硬件检测、公开模型目录同步、完整 GPU 手动配置和 UI 美化。

**Architecture:** 保持 HTML + CSS + 原生 JavaScript。新增 `js/model-sync.js` 作为独立的数据适配层，通过三个公开只读 API 返回统一目录条目并使用 localStorage 缓存；`app.js` 只负责按钮、状态和渲染。GPU 数据继续由 `estimate.js` 提供，手动选择器使用分组 `<optgroup>` 和自定义显存兜底。

**Tech Stack:** HTML5, CSS3, 原生 JavaScript, Node.js 内置 `vm`/`assert` 测试，无新增运行时依赖。

**Spec:** `docs/superpowers/specs/2026-08-20-local-llm-check-design.md`

## Global Constraints

- 纯静态部署，不能要求用户提供 API Token。
- 不上传硬件信息；浏览器无法提供的字段显示未知或需手动设置。
- 保留原有 `MODELS` 精确估算数据，动态目录没有可靠参数/体积时不覆盖它。
- 不提交、不推送、不修改 GitHub Pages 远程状态。
- 新增 UI 遵守键盘焦点、禁用状态、移动端布局和 reduced-motion。

---

### Task 1: 建立关键行为测试

**Files:**
- Create: `tests/test-features.js`
- Modify: `package.json` (only if a test script is useful; do not add a dependency)

**Interfaces:**
- Tests load browser scripts in a Node `vm` context with fake `window`, `document`, `navigator`, `localStorage`, and `fetch`.
- Expected public interfaces: `window.GPU_CATALOG`, `window.ModelSync.normalizeSourceItems`, `window.ModelSync.mergeCatalog`, `window.ModelSync.loadCachedCatalog`.

- [ ] **Step 1: Write failing tests**

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function load(file, extras = {}) {
  const context = { console, URL, setTimeout, clearTimeout, ...extras };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return context;
}

const estimate = load('js/estimate.js');
assert.ok(estimate.GPU_CATALOG.some((gpu) => gpu.vendor === 'AMD'));
assert.ok(estimate.GPU_CATALOG.some((gpu) => gpu.vendor === 'NVIDIA'));
assert.ok(estimate.GPU_CATALOG.some((gpu) => gpu.vendor === 'Intel'));

const sync = load('js/model-sync.js');
const rows = sync.ModelSync.normalizeSourceItems([
  { id: 'Qwen/Qwen3-8B', downloads: 10, lastModified: '2026-08-20T00:00:00Z' },
], 'Hugging Face');
assert.equal(rows[0].id, 'Qwen/Qwen3-8B');
assert.equal(rows[0].source, 'Hugging Face');
assert.equal(sync.ModelSync.mergeCatalog(rows, rows).length, 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-features.js`

Expected: FAIL because `window.GPU_CATALOG` and `js/model-sync.js` do not yet expose the requested interfaces.

- [ ] **Step 3: Keep the test focused on behavior**

Add assertions for a cached catalog fallback and for a source item with no size being marked `needsReview: true`; do not assert CSS class names or implementation details.

### Task 2: 完成本机检测与 GPU 配置数据

**Files:**
- Modify: `index.html`
- Modify: `js/estimate.js`
- Modify: `js/hardware.js`
- Modify: `js/app.js`
- Modify: `css/style.css`
- Test: `tests/test-features.js`

**Interfaces:**
- `window.GPU_CATALOG` exposes the normalized GPU database for tests and UI grouping.
- `showManual()` creates vendor optgroups, selects the detected GPU, and includes an `other` option.
- `applyManual()` stores `gpuCustomName` and `gpuVram` when `other` is selected.

- [ ] **Step 1: Expand GPU records and expose the catalog**

Add `vendor` and `series` fields to existing records, add mainstream NVIDIA RTX 50/40/30/20, GTX 16/10, AMD RX 9000/7000/6000, Intel Arc A/B and integrated options, Apple M1-M4 variants, and set `window.GPU_CATALOG = GPU_DB` after the database. Keep `name`, `vram`, `bw`, and `kind` compatible with current estimate code.

- [ ] **Step 2: Run the focused test**

Run: `node tests/test-features.js`

Expected: GPU vendor assertions pass; model sync assertions still fail until Task 3.

- [ ] **Step 3: Change the detection flow to user initiated**

Remove the `doDetect()` call from the DOMContentLoaded handler. Keep the model table in a clear pre-detection state and make the primary button label “检测本机配置”. On success, render the same existing fields and show the manual panel.

- [ ] **Step 4: Add explicit unknown/custom hardware state**

Use `未读取到` / `需手动设置` for unavailable RAM, disk, GPU, or VRAM. When a custom GPU is selected, preserve the custom name in `HW.gpuString` and use the user-entered VRAM without inventing bandwidth.

- [ ] **Step 5: Add grouped and searchable manual GPU UI**

Replace the flat `<select>` options with vendor groups, add a short search field that filters options, and keep CPU cores, RAM, VRAM, and RAM tier inputs. Selecting a known card autofills VRAM; selecting `other` enables custom name and VRAM fields.

- [ ] **Step 6: Run tests and static syntax checks**

Run: `node tests/test-features.js` and `node --check js/hardware.js` and `node --check js/app.js` and `node --check js/estimate.js`.

Expected: all focused tests pass and all JavaScript files parse successfully.

### Task 3: 添加公开模型目录同步

**Files:**
- Create: `js/model-sync.js`
- Modify: `index.html`
- Modify: `js/app.js`
- Modify: `css/style.css`
- Test: `tests/test-features.js`

**Interfaces:**
- `ModelSync.normalizeSourceItems(items, source)` returns `{ id, name, source, url, downloads, lastModified, needsReview }[]`.
- `ModelSync.mergeCatalog(...lists)` deduplicates by source plus id and returns newest-first entries.
- `ModelSync.refresh()` resolves `{ entries, updatedAt, sources }` and never rejects because one source failed.
- `ModelSync.loadCachedCatalog()` returns the last valid cached result or `null`.

- [ ] **Step 1: Add failing sync tests**

Test `refresh()` with one successful mock source, one rejected source, and a pre-populated cache; assert the success row remains and the result reports the failed source without throwing.

- [ ] **Step 2: Run test to verify sync failure**

Run: `node tests/test-features.js`

Expected: FAIL because `ModelSync.refresh` is not defined.

- [ ] **Step 3: Implement source adapters**

Use these public endpoints with `fetch` and a 12-second timeout:

```js
const SOURCES = {
  hf: 'https://huggingface.co/api/models?pipeline_tag=text-generation&sort=lastModified&direction=-1&limit=24',
  ms: 'https://modelscope.cn/openapi/v1/models?page_number=1&page_size=24',
  github: 'https://api.github.com/search/repositories?q=llm+GGUF+in:name,description&sort=updated&order=desc&per_page=24',
};
```

Normalize fields conservatively, build direct source URLs, and set `needsReview` when parameter count or downloadable file size is absent. Ignore unrelated image/video-only entries for the local LLM catalog.

- [ ] **Step 4: Add cache and partial-failure behavior**

Store only normalized JSON and ISO timestamp in `localStorage` under a versioned key. `refresh()` returns cached entries when all live sources fail and reports `cache` as the active source.

- [ ] **Step 5: Add model update UI**

Add a compact update panel above the model table with “更新模型库”, last update time, source badges, and a status message. Do not replace the existing `MODELS` array; show newly fetched entries in a separate “最新发现” list or append only entries with enough fields for current rendering.

- [ ] **Step 6: Run focused tests and syntax checks**

Run: `node tests/test-features.js` and `node --check js/model-sync.js`.

Expected: all sync tests pass and source failures are represented as status data, not uncaught errors.

### Task 4: UI 美化与回归验证

**Files:**
- Modify: `index.html`
- Modify: `tutorials.html`
- Modify: `css/style.css`
- Test: `tests/test-features.js`

- [ ] **Step 1: Implement the visual hierarchy**

Add a small eyebrow/status line in the hero, make the detection action the dominant control, use consistent status chips for “已检测/粗略/需手动”, and refine cards, focus rings, table headers, and mobile spacing without changing the existing content model.

- [ ] **Step 2: Add accessibility and motion safeguards**

Use real buttons for actions, preserve visible `:focus-visible`, add `aria-live="polite"` to status containers, and wrap nonessential transitions in a `prefers-reduced-motion: reduce` override.

- [ ] **Step 3: Run full local validation**

Run: `node tests/test-features.js`; `node --check js/models.js`; `node --check js/estimate.js`; `node --check js/hardware.js`; `node --check js/model-sync.js`; `node --check js/app.js`; `python -m http.server 8000` and use a browser smoke test to verify the detection button, manual GPU selection, update status, filters, sort, copy action, and tutorial link.

- [ ] **Step 4: Review diff and record limits**

Run: `git status --short` and `git diff --check`; update `agent_memory/progress.md` and `agent_memory/bugs.md` with validation results, API limitations, and any unverified GPU/browser cases.
