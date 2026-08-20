/* ============================================================
 * 主页面逻辑：检测 → 估算 → 对比
 * ============================================================ */

let HW = null;       // 当前硬件信息
let quant = 'Q4_K_M';
let filterTag = '全部';
let sortMode = 'speed';
const GPU_VENDOR_ORDER = ['NVIDIA', 'AMD', 'Intel', 'Apple Silicon', '核显 / 集成显卡'];

const $ = (id) => document.getElementById(id);

/* ---------------- 检测 ---------------- */
async function doDetect() {
  $('btn-detect').disabled = true;
  $('btn-detect').textContent = '检测中…';
  try {
    HW = await detectHardware();
    renderSpecs();
    renderTable();
    showManual();
    $('status').textContent = '✓ 检测完成。请核对下方配置，如有偏差可手动修正。';
  } catch (e) {
    $('status').textContent = '检测失败：' + e.message;
  } finally {
    $('btn-detect').disabled = false;
    $('btn-detect').textContent = '重新检测配置';
  }
}

function renderSpecs() {
  const gpuName = HW.gpu ? HW.gpu.name : (HW.gpuString === '手动设置' ? '未使用独立 GPU' : (HW.gpuString ? '未收录型号' : '未检测到'));
  $('spec-cpu').textContent = HW.cpuCores ? `${HW.cpuCores} 核（逻辑）` : '未知（请手动设置）';
  $('spec-ram').textContent = HW.ramGB ? `约 ${HW.ramGB} GB（浏览器粗估）` : '未知（请手动设置）';
  $('spec-gpu').textContent = HW.gpuString ? `${gpuName}（${HW.gpuString.slice(0, 60)}）` : '未检测到独立 GPU（可能为核显）';
  $('spec-vram').textContent = (HW.gpu && HW.gpu.vram) ? `${HW.gpu.vram} GB` : (HW.gpuVram ? `${HW.gpuVram} GB` : '未知');
  $('spec-disk').textContent = HW.diskFreeGB ? `约 ${HW.diskFreeGB} GB（浏览器估算）` : '未知';
  $('spec-os').textContent = HW.apple ? 'macOS (Apple Silicon)' : (HW.os || '未知');
  $('specs-box').style.display = 'block';
}

function showManual() {
  const gpuSel = $('manual-gpu');
  gpuSel.innerHTML = '<option value="">（使用自动检测的 GPU）</option><option value="none">无独立显卡（纯 CPU）</option>';
  const groups = new Map();
  GPU_VENDOR_ORDER.forEach((vendor) => {
    const group = document.createElement('optgroup');
    group.label = vendor;
    groups.set(vendor, group);
    gpuSel.appendChild(group);
  });
  for (const g of GPU_DB) {
    const o = document.createElement('option');
    o.value = g.name;
    o.dataset.vendor = g.vendor || '其他';
    o.textContent = g.name + (g.vram ? `（${g.vram}GB）` : '（共享/统一内存）');
    if (HW.gpu && HW.gpu.name === g.name) o.selected = true;
    (groups.get(g.vendor) || gpuSel).appendChild(o);
  }
  const other = document.createElement('option');
  other.value = 'other';
  other.textContent = '其他型号（手动填写）';
  gpuSel.appendChild(other);
  if (HW.gpu && !GPU_DB.some((g) => g.name === HW.gpu.name)) gpuSel.value = 'other';
  $('manual-cores').value = HW.cpuCores || 8;
  $('manual-ram').value = HW.ramGB || 16;
  $('manual-vram').value = HW.gpuVram || (HW.gpu && HW.gpu.vram) || '';
  $('manual-tier').value = HW.ramTier || 'unknown';
  $('manual-gpu-kind').value = HW.gpu ? HW.gpu.kind : 'nvidia';
  $('manual-gpu-search').value = '';
  $('manual-custom-name').value = HW.gpu && !GPU_DB.some((g) => g.name === HW.gpu.name) ? HW.gpu.name : '';
  toggleCustomGpuFields();
}

function toggleCustomGpuFields() {
  const custom = $('manual-gpu').value === 'other';
  $('manual-custom-name-wrap').style.display = custom ? 'flex' : 'none';
  if (!custom) $('manual-custom-name').value = '';
}

function handleGpuSelectionChange() {
  const choice = $('manual-gpu').value;
  const selected = GPU_DB.find((gpu) => gpu.name === choice);
  if (selected) {
    $('manual-gpu-kind').value = selected.kind;
    $('manual-vram').value = selected.vram || '';
  } else if (choice === 'none') {
    $('manual-vram').value = '';
  }
  toggleCustomGpuFields();
}

function filterManualGpuOptions() {
  const query = $('manual-gpu-search').value.trim().toLowerCase();
  $('manual-gpu').querySelectorAll('option').forEach((option) => {
    option.hidden = Boolean(query) && !option.textContent.toLowerCase().includes(query);
  });
  $('manual-gpu').querySelectorAll('optgroup').forEach((group) => {
    group.hidden = [...group.options].every((option) => option.hidden);
  });
}

/* ---------------- 手动修正 ---------------- */
function applyManual() {
  const choice = $('manual-gpu').value;
  const overrides = {
    cpuCores: +$('manual-cores').value,
    ramGB: +$('manual-ram').value,
    gpuChoice: choice,
    gpuCustomName: $('manual-custom-name').value.trim(),
    gpuKind: $('manual-gpu-kind').value,
    gpuVram: $('manual-vram').value ? +$('manual-vram').value : null,
    ramTier: $('manual-tier').value,
  };
  if ($('manual-vram').value) overrides.gpuBw = 300; // 未知带宽的中档默认
  saveOverride(overrides);
  HW = null; // 强制重新加载
  HW = { ...{ cpuCores: overrides.cpuCores, ramGB: overrides.ramGB, gpuVram: overrides.gpuVram, gpuBw: overrides.gpuBw, ramTier: overrides.ramTier, gpu: null, os: 'manual', apple: false, gpuString: '手动设置', diskFreeGB: null } };
  const gpuChoice = overrides.gpuChoice;
  if (gpuChoice && gpuChoice !== 'none') {
    const g = gpuChoice === 'other'
      ? { name: overrides.gpuCustomName || '自定义 GPU', vram: overrides.gpuVram, bw: overrides.gpuBw, kind: overrides.gpuKind || 'nvidia', vendor: '自定义' }
      : GPU_DB.find((x) => x.name === gpuChoice);
    if (g) HW.gpu = g;
  }
  renderSpecs();
  renderTable();
  $('status').textContent = '✓ 已按手动配置重新计算。';
}

/* ---------------- 基准校准 ---------------- */
async function doBench() {
  $('btn-bench').disabled = true;
  $('bench-result').textContent = '运行中…（约 1 秒）';
  const scale = await runBenchmark();
  saveOverride({ benchScale: scale });
  if (HW) HW.benchScale = scale;
  $('bench-result').textContent = `校准因子 ×${scale}（浏览器 JS 速度与参考机对比，粗略校准 CPU 估算）`;
  if (HW) renderTable();
  $('btn-bench').disabled = false;
}

/* ---------------- 为你推荐 ---------------- */
function renderRecommend(rows) {
  const box = $('recommend');
  const sec = $('rec-section');
  const good = rows.filter((r) => r.fit.level === 'green' && r.est.speed > 0);
  if (!good.length) {
    sec.style.display = 'block';
    const smallest = [...rows].sort((a, b) => a.size - b.size)[0];
    box.innerHTML = `<div class="rec-card warn">
      <div class="rec-title">⚠️ 暂无流畅可跑模型</div>
      <div class="rec-why">当前配置下最接近可运行的是 <b>${smallest.m.name}</b>（Q4 约 ${smallest.size.toFixed(1)}GB，需内存 ${smallest.rNeed.toFixed(1)}GB）。</div>
      <div class="rec-why">建议：升级内存 / 使用更小量化（IQ4_XS、Q3） / 换更小模型。</div>
    </div>`;
    return;
  }
  // 三个推荐角度：最快、最强（体积最大）、最值（MoE 性价比）
  const fastest = [...good].sort((a, b) => b.est.speed - a.est.speed)[0];
  const strongest = [...good].sort((a, b) => b.size - a.size)[0];
  const moeBest = good.filter((r) => r.m.active).sort((a, b) => b.est.speed - a.est.speed)[0];
  const picks = [fastest, strongest];
  if (moeBest && !picks.includes(moeBest)) picks.push(moeBest);

  const title = (r) => (r === fastest ? '⚡ 速度最快' : r === strongest ? '🧠 能力最强' : '💡 MoE 性价比之选');
  box.innerHTML = picks.map((r) => {
    const cmd = r.m.ollama ? `ollama pull ${r.m.ollama}` : '';
    return `<div class="rec-card">
      <div class="rec-title">${title(r)} · ${r.m.name}</div>
      <div class="rec-why">${r.m.note}</div>
      <div class="rec-speed">约 ${r.est.speed.toFixed(1)} tok/s <span class="sub">（${r.est.mode === 'gpu' ? 'GPU' : r.est.mode === 'offload' ? 'GPU+CPU' : 'CPU'}，Q4_K_M）</span></div>
      <div class="rec-links">
        ${cmd ? `<button class="btn-link copy" data-cmd="${cmd}">复制 ${cmd}</button>` : ''}
        <a class="btn-link" href="${r.m.hf}" target="_blank" rel="noopener">HuggingFace</a>
        <a class="btn-link ms" href="${r.m.ms}" target="_blank" rel="noopener">ModelScope</a>
      </div>
    </div>`;
  }).join('');
  sec.style.display = 'block';
}

/* ---------------- 表格 ---------------- */
function filteredModels() {
  let list = MODELS.slice();
  if (filterTag !== '全部') list = list.filter((m) => m.tags.includes(filterTag) || m.cat === filterTag);
  const q = $('search').value.trim().toLowerCase();
  if (q) list = list.filter((m) => m.name.toLowerCase().includes(q) || m.family.toLowerCase().includes(q));
  return list;
}

function computeRow(m) {
  const size = modelSizeGB(m, quant);
  const rNeed = ramNeedGB(m, quant);
  const vNeed = vramNeedGB(m, quant);
  const fit = checkFit(m, quant, HW);
  const est = estSpeed(m, quant, HW);
  return { m, size, rNeed, vNeed, fit, est };
}

function renderTable() {
  if (!HW) { $('model-table-body').innerHTML = '<tr><td colspan="8" class="empty">请先点击「检测我的电脑」</td></tr>'; return; }
  const rows = filteredModels().map(computeRow);

  if (sortMode === 'size') rows.sort((a, b) => a.size - b.size);
  else if (sortMode === 'speed') {
    rows.sort((a, b) => {
      const ga = a.est.speed, gb = b.est.speed;
      return (gb - ga);
    });
  } else if (sortMode === 'fit') {
    const lv = { green: 0, yellow: 1, red: 2 };
    rows.sort((a, b) => lv[a.fit.level] - lv[b.fit.level] || b.est.speed - a.est.speed);
  }

  $('model-table-body').innerHTML = rows.map(rowHtml).join('');
  renderChart(rows);
  renderRecommend(rows);
}

function rowHtml({ m, size, rNeed, vNeed, fit, est }) {
  const badge = {
    green: '<span class="badge green">✓ 可运行</span>',
    yellow: '<span class="badge yellow">⚠ 可用（受限）</span>',
    red: '<span class="badge red">✗ 内存不足</span>',
  }[fit.level];

  const speedCell = est.speed > 0
    ? `<span class="speed-num">${est.speed.toFixed(1)}</span> tok/s`
    : '—';

  const cmd = `ollama pull ${m.ollama}`;
  const ollamaBtn = m.ollama
    ? `<button class="btn-link copy" data-cmd="${cmd}" title="复制 ollama pull 命令">Ollama</button>`
    : `<a class="btn-link" href="https://ollama.com/search?q=${encodeURIComponent(m.name)}" target="_blank" rel="noopener" title="在 Ollama 库中搜索">Ollama</a>`;
  const links = `
    <a class="btn-link" href="${m.hf}" target="_blank" rel="noopener">HuggingFace</a>
    <a class="btn-link ms" href="${m.ms}" target="_blank" rel="noopener">ModelScope</a>
    ${ollamaBtn}
  `;

  return `<tr data-level="${fit.level}">
    <td class="m-name">${m.name}${m.active ? ' <span class="moe">MoE</span>' : ''}<div class="m-note">${m.note}</div></td>
    <td>${m.params}${m.active ? `B<span class="sub">（激活 ${m.active}B）</span>` : 'B'}</td>
    <td>${size.toFixed(1)} GB</td>
    <td>${rNeed.toFixed(1)} GB</td>
    <td>${vNeed.toFixed(1)} GB</td>
    <td>${badge}<div class="reason">${fit.reason}</div></td>
    <td class="num">${speedCell}<div class="sub">${est.mode === 'gpu' ? 'GPU' : est.mode === 'offload' ? 'GPU+CPU' : 'CPU'}</div></td>
    <td>${links}</td>
  </tr>`;
}

/* ---------------- 速度对比条形图（兼容模型） ---------------- */
function renderChart(rows) {
  const box = $('chart');
  const ok = rows.filter((r) => r.fit.level !== 'red' && r.est.speed > 0).slice(0, 12);
  if (!ok.length) { box.innerHTML = '<p class="empty">暂无符合条件的对比数据</p>'; return; }
  const max = Math.max(...ok.map((r) => r.est.speed));
  const color = (r) => r.fit.level === 'green' ? '#4ade80' : '#facc15';
  box.innerHTML = ok.map((r) => `
    <div class="bar-row" title="${r.m.name}：约 ${r.est.speed.toFixed(1)} tok/s（${r.est.mode}）">
      <div class="bar-label">${r.m.name}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(r.est.speed / max * 100).toFixed(1)}%;background:${color(r)}"></div></div>
      <div class="bar-val">${r.est.speed.toFixed(1)}</div>
    </div>`).join('');
}

function renderLiveModels(result) {
  const box = $('live-models');
  if (!box) return;
  box.innerHTML = '';
  const entries = (result && result.entries) || [];
  if (!entries.length) {
    box.innerHTML = '<p class="empty live-empty">暂时没有在线模型数据，内置模型库仍可正常使用。</p>';
    return;
  }
  const title = document.createElement('div');
  title.className = 'live-heading';
  title.textContent = `最新发现 · ${Math.min(entries.length, 18)} 条`;
  box.appendChild(title);
  entries.slice(0, 18).forEach((entry) => {
    const card = document.createElement('article');
    card.className = 'live-model';
    const source = document.createElement('span');
    source.className = 'source-chip';
    source.textContent = entry.source;
    const link = document.createElement('a');
    link.href = entry.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = entry.name;
    const meta = document.createElement('div');
    meta.className = 'live-meta';
    meta.textContent = `${entry.downloads ? `${entry.downloads.toLocaleString()} 次下载/收藏` : '暂无热度数据'}${entry.needsReview ? ' · 参数/体积待核对' : ''}`;
    card.append(source, link, meta);
    box.appendChild(card);
  });
}

function updateModelSyncStatus(result, loading = false) {
  const status = $('model-sync-status');
  if (!status) return;
  if (loading) {
    status.textContent = '正在从 Hugging Face、ModelScope、GitHub 获取最新公开目录…';
    return;
  }
  const updated = result && result.updatedAt ? new Date(result.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '暂无成功更新';
  const sources = result && result.sources && result.sources.length ? result.sources.join('、') : '缓存';
  const failed = result && result.failedSources && result.failedSources.length ? `；失败：${result.failedSources.join('、')}` : '';
  status.textContent = `上次更新：${updated} · 已接入：${sources}${failed}`;
}

async function doSyncModels() {
  const button = $('btn-sync-models');
  if (!button || !window.ModelSync) return;
  button.disabled = true;
  button.textContent = '更新中…';
  updateModelSyncStatus(null, true);
  try {
    const result = await window.ModelSync.refresh();
    renderLiveModels(result);
    updateModelSyncStatus(result);
  } catch (error) {
    const cached = window.ModelSync.loadCachedCatalog();
    renderLiveModels(cached);
    updateModelSyncStatus({ ...cached, failedSources: ['全部来源'] });
  } finally {
    button.disabled = false;
    button.textContent = '↻ 更新模型库';
  }
}

/* ---------------- 事件绑定 ---------------- */
document.addEventListener('DOMContentLoaded', () => {
  $('btn-detect').addEventListener('click', doDetect);
  $('btn-bench').addEventListener('click', doBench);
  $('btn-apply-manual').addEventListener('click', applyManual);
  $('manual-gpu').addEventListener('change', handleGpuSelectionChange);
  $('manual-gpu-search').addEventListener('input', filterManualGpuOptions);
  $('btn-sync-models').addEventListener('click', doSyncModels);

  const cachedModels = window.ModelSync && window.ModelSync.loadCachedCatalog();
  if (cachedModels) {
    renderLiveModels(cachedModels);
    updateModelSyncStatus(cachedModels);
  }

  document.querySelectorAll('.quant-tab').forEach((el) => {
    el.addEventListener('click', () => {
      quant = el.dataset.quant;
      document.querySelectorAll('.quant-tab').forEach((t) => t.classList.toggle('active', t === el));
      if (HW) renderTable();
    });
  });

  document.querySelectorAll('.chip').forEach((el) => {
    el.addEventListener('click', () => {
      filterTag = el.dataset.tag;
      document.querySelectorAll('.chip').forEach((t) => t.classList.toggle('active', t === el));
      if (HW) renderTable();
    });
  });

  $('search').addEventListener('input', () => HW && renderTable());
  $('sort').addEventListener('change', (e) => { sortMode = e.target.value; HW && renderTable(); });

  // 复制 ollama 命令
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.copy');
    if (!btn) return;
    const cmd = btn.dataset.cmd;
    navigator.clipboard.writeText(cmd).then(() => {
      const old = btn.textContent;
      btn.textContent = '已复制 ✓';
      setTimeout(() => (btn.textContent = old), 1200);
    });
  });

});
