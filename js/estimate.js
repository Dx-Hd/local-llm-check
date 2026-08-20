/* ============================================================
 * 估算引擎：显存/内存需求、兼容性判断、token 速度估算
 * 速度估算基于「内存带宽决定生成速度」的物理模型，
 * 因子取自 llama.cpp / Ollama 社区公开基准（2024-2025）。
 * 所有数值均为估算值，仅供参考。
 * ============================================================ */

// 量化 → 每参数字节数
const BYTES_PER_PARAM = { 'Q4_K_M': 0.58, 'Q8_0': 1.06, 'FP16': 2.0 };

// GGUF 文件体积（GB）
// 1e9 参数 × b 字节/参数 = b×1e9 字节；1 GiB = 2^30 ≈ 1.074e9 字节
function modelSizeGB(model, quant) {
  return model.quant[quant] || (model.params * BYTES_PER_PARAM[quant]) / 1.074;
}

// 生成 1 个 token 需要读取的权重体积（GB）：MoE 只看激活参数
function bytesPerTokenGB(model, quant) {
  const active = model.active || model.params;
  return (active * BYTES_PER_PARAM[quant]) / 1.074;
}

/* ---------------- GPU 数据库（显存 GB / 带宽 GB/s） ---------------- */
const GPU_DB = [
  // NVIDIA 50 系
  { re: /rtx\s*5090(?!\s*laptop)/i,       name: 'RTX 5090',        vram: 32, bw: 1792, kind: 'nvidia' },
  { re: /rtx\s*5080(?!\s*laptop)/i,       name: 'RTX 5080',        vram: 16, bw: 960,  kind: 'nvidia' },
  { re: /rtx\s*5070\s*ti(?!\s*laptop)/i, name: 'RTX 5070 Ti',     vram: 16, bw: 896,  kind: 'nvidia' },
  { re: /rtx\s*5070(?!\s*laptop)/i,       name: 'RTX 5070',        vram: 12, bw: 672,  kind: 'nvidia' },
  { re: /rtx\s*5060\s*ti(?!\s*laptop)/i, name: 'RTX 5060 Ti',     vram: 16, bw: 448,  kind: 'nvidia' },
  { re: /rtx\s*5060(?!\s*laptop)/i,       name: 'RTX 5060',        vram: 8,  bw: 448,  kind: 'nvidia' },
  // NVIDIA 40 系（负向前瞻避免误吞 Laptop 版）
  { re: /rtx\s*4090(?!\s*laptop)/i,  name: 'RTX 4090',        vram: 24, bw: 1008, kind: 'nvidia' },
  { re: /rtx\s*4080(?!\s*laptop)/i,   name: 'RTX 4080 (Super)', vram: 16, bw: 736,  kind: 'nvidia' },
  { re: /rtx\s*4070\s*ti(?!\s*laptop)/i, name: 'RTX 4070 Ti',  vram: 12, bw: 672,  kind: 'nvidia' },
  { re: /rtx\s*4070(?!\s*laptop)/i,   name: 'RTX 4070',        vram: 12, bw: 504,  kind: 'nvidia' },
  { re: /rtx\s*4060\s*ti(?!\s*laptop)/i, name: 'RTX 4060 Ti',  vram: 16, bw: 288,  kind: 'nvidia' },
  { re: /rtx\s*4060(?!\s*laptop)/i,   name: 'RTX 4060',        vram: 8,  bw: 272,  kind: 'nvidia' },
  // NVIDIA 30 系
  { re: /rtx\s*3090/i,                name: 'RTX 3090',        vram: 24, bw: 936,  kind: 'nvidia' },
  { re: /rtx\s*3080\s*ti/i,           name: 'RTX 3080 Ti',     vram: 12, bw: 912,  kind: 'nvidia' },
  { re: /rtx\s*3080/i,                name: 'RTX 3080',        vram: 10, bw: 760,  kind: 'nvidia' },
  { re: /rtx\s*3070\s*ti/i,           name: 'RTX 3070 Ti',     vram: 8,  bw: 608,  kind: 'nvidia' },
  { re: /rtx\s*3070/i,                name: 'RTX 3070',        vram: 8,  bw: 448,  kind: 'nvidia' },
  { re: /rtx\s*3060\s*ti(?!\s*laptop)/i, name: 'RTX 3060 Ti',  vram: 8,  bw: 448,  kind: 'nvidia' },
  { re: /rtx\s*3060(?!\s*laptop)/i,   name: 'RTX 3060',        vram: 12, bw: 360,  kind: 'nvidia' },
  // NVIDIA 20/10 系
  { re: /rtx\s*2080\s*ti/i,           name: 'RTX 2080 Ti',     vram: 11, bw: 616,  kind: 'nvidia' },
  { re: /rtx\s*2080/i,                name: 'RTX 2080',        vram: 8,  bw: 448,  kind: 'nvidia' },
  { re: /rtx\s*2070/i,                name: 'RTX 2070',        vram: 8,  bw: 448,  kind: 'nvidia' },
  { re: /rtx\s*2060/i,                name: 'RTX 2060',        vram: 6,  bw: 336,  kind: 'nvidia' },
  { re: /gtx\s*1080\s*ti/i,           name: 'GTX 1080 Ti',     vram: 11, bw: 484,  kind: 'nvidia' },
  { re: /gtx\s*1080/i,                name: 'GTX 1080',        vram: 8,  bw: 320,  kind: 'nvidia' },
  { re: /gtx\s*1660\s*(super|ti)?/i,  name: 'GTX 1660 (S/Ti)', vram: 6,  bw: 288,  kind: 'nvidia' },
  { re: /gtx\s*1060/i,                name: 'GTX 1060',        vram: 6,  bw: 192,  kind: 'nvidia' },
  // NVIDIA 笔记本
  { re: /rtx\s*4090\s*laptop/i,       name: 'RTX 4090 Laptop', vram: 16, bw: 576,  kind: 'nvidia' },
  { re: /rtx\s*4080\s*laptop/i,       name: 'RTX 4080 Laptop', vram: 12, bw: 432,  kind: 'nvidia' },
  { re: /rtx\s*4070\s*laptop/i,       name: 'RTX 4070 Laptop', vram: 8,  bw: 256,  kind: 'nvidia' },
  { re: /rtx\s*4060\s*laptop/i,       name: 'RTX 4060 Laptop', vram: 8,  bw: 256,  kind: 'nvidia' },
  { re: /rtx\s*3060\s*laptop/i,       name: 'RTX 3060 Laptop', vram: 6,  bw: 336,  kind: 'nvidia' },
  { re: /rtx\s*3050/i,                name: 'RTX 3050',        vram: 8,  bw: 224,  kind: 'nvidia' },
  { re: /rtx\s*5090\s*laptop/i,       name: 'RTX 5090 Laptop',  vram: 24, bw: 896,  kind: 'nvidia' },
  { re: /rtx\s*5080\s*laptop/i,       name: 'RTX 5080 Laptop',  vram: 16, bw: 512,  kind: 'nvidia' },
  { re: /rtx\s*5070\s*ti\s*laptop/i, name: 'RTX 5070 Ti Laptop', vram: 12, bw: 448, kind: 'nvidia' },
  { re: /rtx\s*5070\s*laptop/i,       name: 'RTX 5070 Laptop',  vram: 8,  bw: 384,  kind: 'nvidia' },
  { re: /rtx\s*5060\s*laptop/i,       name: 'RTX 5060 Laptop',  vram: 8,  bw: 384,  kind: 'nvidia' },
  // NVIDIA 专业卡与常见服务器卡
  { re: /rtx\s*a6000/i,               name: 'RTX A6000',        vram: 48, bw: 768,  kind: 'nvidia' },
  { re: /rtx\s*a5000/i,               name: 'RTX A5000',        vram: 24, bw: 768,  kind: 'nvidia' },
  { re: /rtx\s*a4000/i,               name: 'RTX A4000',        vram: 16, bw: 448,  kind: 'nvidia' },
  { re: /quadro\s*rtx\s*8000/i,      name: 'Quadro RTX 8000',  vram: 48, bw: 672,  kind: 'nvidia' },
  { re: /tesla\s*v100/i,              name: 'Tesla V100',       vram: 16, bw: 900,  kind: 'nvidia' },
  { re: /tesla\s*t4/i,                name: 'Tesla T4',         vram: 16, bw: 320,  kind: 'nvidia' },
  // AMD RDNA4/3
  { re: /rx\s*9070\s*xt/i,            name: 'RX 9070 XT',      vram: 16, bw: 644,  kind: 'amd' },
  { re: /rx\s*9070/i,                 name: 'RX 9070',         vram: 16, bw: 500,  kind: 'amd' },
  { re: /rx\s*9060\s*xt/i,            name: 'RX 9060 XT',       vram: 16, bw: 320,  kind: 'amd' },
  { re: /rx\s*7900\s*xtx/i,           name: 'RX 7900 XTX',     vram: 24, bw: 960,  kind: 'amd' },
  { re: /rx\s*7900\s*xt/i,            name: 'RX 7900 XT',      vram: 20, bw: 800,  kind: 'amd' },
  { re: /rx\s*7800\s*xt/i,            name: 'RX 7800 XT',      vram: 16, bw: 624,  kind: 'amd' },
  { re: /rx\s*7700\s*xt/i,            name: 'RX 7700 XT',      vram: 12, bw: 432,  kind: 'amd' },
  { re: /rx\s*7600/i,                 name: 'RX 7600',         vram: 8,  bw: 288,  kind: 'amd' },
  { re: /rx\s*6900\s*xt/i,            name: 'RX 6900 XT',      vram: 16, bw: 512,  kind: 'amd' },
  { re: /rx\s*6800\s*xt/i,            name: 'RX 6800 XT',      vram: 16, bw: 512,  kind: 'amd' },
  { re: /rx\s*6700\s*xt/i,            name: 'RX 6700 XT',      vram: 12, bw: 384,  kind: 'amd' },
  { re: /rx\s*6600/i,                 name: 'RX 6600',         vram: 8,  bw: 256,  kind: 'amd' },
  { re: /rx\s*6500\s*xt/i,            name: 'RX 6500 XT',       vram: 4,  bw: 144,  kind: 'amd' },
  // AMD 专业卡与集成显卡
  { re: /radeon\s*pro\s*w7900/i,      name: 'Radeon Pro W7900', vram: 48, bw: 864, kind: 'amd' },
  { re: /radeon\s*pro\s*w7800/i,      name: 'Radeon Pro W7800', vram: 32, bw: 576, kind: 'amd' },
  { re: /radeon\s*pro\s*w6800/i,      name: 'Radeon Pro W6800', vram: 32, bw: 512, kind: 'amd' },
  { re: /radeon\s*780m/i,              name: 'Radeon 780M',      vram: null, bw: 89, kind: 'igpu' },
  { re: /radeon\s*760m/i,              name: 'Radeon 760M',      vram: null, bw: 76, kind: 'igpu' },
  // Intel 独显
  { re: /arc\s*a770/i,                name: 'Arc A770',        vram: 16, bw: 560,  kind: 'intel' },
  { re: /arc\s*a750/i,                name: 'Arc A750',        vram: 8,  bw: 512,  kind: 'intel' },
  { re: /arc\s*b580/i,                name: 'Arc B580',        vram: 12, bw: 456,  kind: 'intel' },
  { re: /arc\s*b570/i,                name: 'Arc B570',        vram: 10, bw: 380,  kind: 'intel' },
  { re: /arc\s*a380/i,                name: 'Arc A380',        vram: 6,  bw: 186,   kind: 'intel' },
  { re: /intel\s*(uhd|iris|xe)/i,     name: 'Intel UHD / Iris Xe', vram: null, bw: null, kind: 'igpu' },
  // Apple Silicon（带宽 GB/s）
  { re: /apple\s*m4\s*(pro|max)?/i,   name: 'Apple M4',        vram: null, bw: 273,  kind: 'apple' },
  { re: /apple\s*m3\s*(pro|max)?/i,   name: 'Apple M3',        vram: null, bw: 150,  kind: 'apple' },
  { re: /apple\s*m2\s*(pro|max)?/i,   name: 'Apple M2',        vram: null, bw: 100,  kind: 'apple' },
  { re: /apple\s*m1\s*(pro|max)?/i,   name: 'Apple M1',        vram: null, bw: 68,   kind: 'apple' },
  // 集显（最后兜底匹配，因子低）
  { re: /uhd|iris|hd\s*graphics|radeon\s*graphics|radeon\s*vega|radeon\s*\d+\s*series/i, name: '核显 iGPU', vram: null, bw: null, kind: 'igpu' },
];

// 手动修正面板使用的统一厂商标签；估算逻辑仍沿用 kind 字段。
const GPU_VENDOR_LABELS = {
  nvidia: 'NVIDIA', amd: 'AMD', intel: 'Intel', apple: 'Apple Silicon', igpu: '核显 / 集成显卡',
};
GPU_DB.forEach((gpu) => {
  gpu.vendor = gpu.vendor || GPU_VENDOR_LABELS[gpu.kind] || '其他';
  gpu.series = gpu.series || gpu.vendor;
});
if (typeof window !== 'undefined') window.GPU_CATALOG = GPU_DB;

const GPU_SPEED_FACTOR = { nvidia: 0.75, amd: 0.68, intel: 0.30, apple: 0.60, igpu: 0.16 };
const MOE_FACTOR = 0.55; // MoE 路由与负载均衡开销

function matchGPU(gpuString) {
  if (!gpuString) return null;
  for (const g of GPU_DB) {
    if (g.re.test(gpuString)) return g;
  }
  return null;
}

/* ---------------- CPU 内存带宽（GB/s，按档次估算） ---------------- */
const RAM_BW = {
  'ddr3-single': 8, 'ddr3-dual': 17, 'ddr4-single': 17, 'ddr4-dual': 32,
  'ddr5-single': 28, 'ddr5-dual': 60, 'server-dual': 90, 'unknown': 25,
};

// 根据检测到的内存量猜测内存档次（可被用户手动覆盖）
function guessRamTier(ramGB) {
  if (ramGB >= 64) return 'ddr5-dual';
  if (ramGB >= 16) return 'ddr4-dual';
  if (ramGB >= 8) return 'ddr4-single';
  return 'unknown';
}

/* ---------------- 需求计算 ---------------- */
function ramNeedGB(model, quant) {
  return modelSizeGB(model, quant) + 4; // 模型 + 系统/开销
}

function vramNeedGB(model, quant) {
  return modelSizeGB(model, quant) + 1.5; // 模型 + KV cache/开销
}

/* ---------------- 速度估算 ---------------- */
// hw: { cpuCores, ramGB, gpu, gpuVram, ramTier, benchScale }
// 返回 { speed, mode, note }  speed 单位 tok/s
function estSpeed(model, quant, hw) {
  const size = modelSizeGB(model, quant);
  const bpt = bytesPerTokenGB(model, quant);
  const gpu = hw.gpu;

  // Apple Silicon：统一内存，直接按带宽算 GPU 速度（需 RAM 容纳模型）
  if (gpu && gpu.kind === 'apple') {
    let speed = (gpu.bw * GPU_SPEED_FACTOR.apple) / bpt;
    if (model.active) speed *= MOE_FACTOR;
    speed = Math.min(speed, 900);
    return {
      speed, mode: 'gpu',
      note: hw.ramGB && hw.ramGB >= vramNeedGB(model, quant)
        ? 'Apple 统一内存，Metal GPU 全量推理'
        : 'Apple 统一内存不足，速度将明显下降',
    };
  }

  if (gpu && gpu.kind !== 'igpu' && (gpu.vram || hw.gpuVram)) {
    const vram = gpu.vram || hw.gpuVram;
    if (vram >= vramNeedGB(model, quant)) {
      // 全量进显存
      let bw = gpu.bw;
      if (!bw && hw.gpuVram) bw = hw.gpuBw || 300; // 未知带宽按中档
      let speed = (bw * GPU_SPEED_FACTOR[gpu.kind]) / bpt;
      if (model.active) speed *= MOE_FACTOR;
      speed = Math.min(speed, 900); // 极小模型受单步开销限制，封顶
      return {
        speed, mode: 'gpu',
        note: `显存充足（需 ${vramNeedGB(model, quant).toFixed(1)}GB），全量 GPU 推理`,
      };
    } else {
      // 部分 offload
      const ratio = vram / size;
      const cpuPart = cpuSpeed(model, quant, hw);
      let gpuPart = 0;
      if (gpu.bw) {
        gpuPart = ((gpu.bw * GPU_SPEED_FACTOR[gpu.kind]) / bpt) * ratio;
        if (model.active) gpuPart *= MOE_FACTOR;
      } else {
        gpuPart = cpuPart * 2 * ratio;
      }
      const speed = gpuPart + cpuPart * (1 - ratio);
      return {
        speed, mode: 'offload',
        note: `显存不足（需 ${vramNeedGB(model, quant).toFixed(1)}GB，实际 ${vram}GB），约 ${Math.round(ratio * 100)}% 层进显存，速度会明显下降`,
      };
    }
  }
  return { speed: cpuSpeed(model, quant, hw), mode: 'cpu', note: 'CPU 推理（无可用独立显卡）' };
}

function cpuSpeed(model, quant, hw) {
  const bw = RAM_BW[hw.ramTier] || 25;
  let speed = (bw * 0.72) / bytesPerTokenGB(model, quant);
  if (model.active) speed *= MOE_FACTOR;
  // 核心数修正：少于 8 核时带宽利用率下降
  const cores = hw.cpuCores || 8;
  const coreFactor = Math.min(1, Math.pow(cores / 8, 0.65));
  speed *= coreFactor;
  // 浏览器基准校准（可选）
  if (hw.benchScale) speed *= hw.benchScale;
  return speed;
}

/* ---------------- 兼容性判断 ---------------- */
// 返回 { ok, level: 'green'|'yellow'|'red', reason }
function checkFit(model, quant, hw) {
  const size = modelSizeGB(model, quant);
  const rNeed = ramNeedGB(model, quant);
  const vNeed = vramNeedGB(model, quant);
  const ram = hw.ramGB;
  const gpu = hw.gpu;

  if (!ram) return { ok: true, level: 'yellow', reason: '未检测到内存信息，请手动设置后查看' };

  if (ram < rNeed) {
    return {
      ok: false, level: 'red',
      reason: `内存不足：需要 ≥${Math.ceil(rNeed)}GB，当前 ${ram}GB（建议 ${Math.ceil(rNeed - 4)}GB 以上剩余）`,
    };
  }

  // Apple 统一内存：显存需求由 RAM 承担
  if (gpu && gpu.kind === 'apple') {
    return ram >= vNeed
      ? { ok: true, level: 'green', reason: `统一内存充足，可全量 GPU 运行（需 ≥${vNeed.toFixed(1)}GB）` }
      : { ok: true, level: 'yellow', reason: `统一内存紧张（需 ${vNeed.toFixed(1)}GB，实际 ${ram}GB），速度会下降` };
  }

  if (gpu && gpu.kind !== 'igpu') {
    const vram = gpu.vram || hw.gpuVram;
    if (vram && vram >= vNeed) {
      return { ok: true, level: 'green', reason: `可全量 GPU 运行（需显存 ≥${vNeed.toFixed(1)}GB）` };
    }
    if (vram) {
      return { ok: true, level: 'yellow', reason: `显存不足，部分层走 CPU（需显存 ${vNeed.toFixed(1)}GB，实际 ${vram}GB）` };
    }
  }
  if (gpu && gpu.kind === 'igpu') {
    return { ok: true, level: 'yellow', reason: '仅有核显，走 CPU/核显推理，速度较慢但可用' };
  }
  return { ok: true, level: 'green', reason: 'CPU 推理可行（速度取决于内存带宽）' };
}
