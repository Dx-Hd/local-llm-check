/* ============================================================
 * 硬件检测：浏览器 API 尽力检测 + 手动修正（localStorage 持久化）
 * 注意：浏览器无法直接读取内存总量/显存，以下数值均为近似
 * ============================================================ */

const HW_STORE_KEY = 'llmh_hw_v1';

async function detectHardware() {
  const hw = {
    cpuCores: null,     // 逻辑核心数
    ramGB: null,        // 内存（Chromium 的 navigator.deviceMemory，粗粒度）
    gpuString: null,    // WebGL 返回的 GPU 名称
    gpu: null,          // GPU_DB 匹配结果
    gpuVram: null,      // 手动输入的显存
    os: null,
    apple: false,
    diskFreeGB: null,   // 可用磁盘（估算，Chromium only）
    ramTier: null,      // 内存档次
    benchScale: null,   // 浏览器基准校准因子
  };

  // CPU 核心数
  if (navigator.hardwareConcurrency) hw.cpuCores = navigator.hardwareConcurrency;

  // 内存（仅 Chromium 提供，且是近似粗粒度）
  if (navigator.deviceMemory) hw.ramGB = navigator.deviceMemory;

  // 系统
  try {
    const ua = navigator.userAgentData;
    if (ua) {
      hw.os = (ua.platform || 'unknown').toLowerCase();
      const high = await ua.getHighEntropyValues(['architecture']).catch(() => null);
      if (hw.os.includes('mac') && high && high.architecture === 'arm') hw.apple = true;
    } else {
      const p = (navigator.platform || '').toLowerCase();
      hw.os = p.includes('win') ? 'windows' : p.includes('mac') ? 'mac' : p.includes('linux') ? 'linux' : 'unknown';
      // macOS + Apple Silicon 提示：无法从 UA 精确判断，交用户确认
    }
  } catch (e) { /* ignore */ }

  // GPU（WebGL）
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const raw = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      hw.gpuString = String(raw || '');
      if (!/swiftshader|software|llvmpipe/i.test(hw.gpuString)) {
        hw.gpu = matchGPU(hw.gpuString);
      }
    }
  } catch (e) { /* ignore */ }

  // 磁盘（Chromium only，估算）
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      if (est.quota && est.quota > 0) hw.diskFreeGB = Math.round(est.quota / 1024 ** 3);
    }
  } catch (e) { /* ignore */ }

  // 内存档次猜测
  hw.ramTier = guessRamTier(hw.ramGB || 16);

  // 应用手动覆盖
  applyOverride(hw);
  return hw;
}

/* ---------------- 手动覆盖 ---------------- */
function applyOverride(hw) {
  try {
    const saved = JSON.parse(localStorage.getItem(HW_STORE_KEY) || 'null');
    if (!saved) return;
    if (saved.cpuCores) hw.cpuCores = +saved.cpuCores;
    if (saved.ramGB) hw.ramGB = +saved.ramGB;
    if (saved.gpuVram) hw.gpuVram = +saved.gpuVram;
    if (saved.gpuBw) hw.gpuBw = +saved.gpuBw;
    if (saved.ramTier) hw.ramTier = saved.ramTier;
    if (saved.gpuChoice) {
      // 用户手动选择 GPU（"none" 表示无独显）
      if (saved.gpuChoice === 'none') hw.gpu = null;
      else if (saved.gpuChoice === 'other') {
        hw.gpu = {
          name: saved.gpuCustomName || '自定义 GPU',
          vram: saved.gpuVram || null,
          bw: saved.gpuBw || null,
          kind: saved.gpuKind || 'nvidia',
          vendor: '自定义',
        };
      }
      else {
        const g = GPU_DB.find((x) => x.name === saved.gpuChoice);
        if (g) hw.gpu = g;
      }
    }
    if (saved.benchScale) hw.benchScale = +saved.benchScale;
    if (saved.apple !== undefined && saved.apple !== null) hw.apple = saved.apple;
  } catch (e) { /* ignore */ }
}

function saveOverride(overrides) {
  const prev = {};
  try { Object.assign(prev, JSON.parse(localStorage.getItem(HW_STORE_KEY) || '{}')); } catch (e) {}
  localStorage.setItem(HW_STORE_KEY, JSON.stringify(Object.assign(prev, overrides)));
}

/* ---------------- 浏览器基准（粗略校准 CPU 估算） ---------------- */
// 测量 JS 浮点运算速度，与参考机（约 100 分）比较出校准因子
function runBenchmark() {
  return new Promise((resolve) => {
    const t0 = performance.now();
    let x = 1.0000001;
    let sum = 0;
    const N = 3e7;
    // 避免被 JIT 优化掉
    const sink = () => sum;
    for (let i = 0; i < N; i++) { x = x * 1.0000003 + 0.0000001; sum += x; }
    const dt = performance.now() - t0;
    const score = N / dt; // ops/ms
    sink();
    // 参考机（i5-12400 Chrome）约 250k ops/ms → 因子 = score / 250000，限制在 0.5~1.5
    let scale = score / 250000;
    scale = Math.min(1.5, Math.max(0.5, scale));
    resolve(Math.round(scale * 100) / 100);
  });
}
