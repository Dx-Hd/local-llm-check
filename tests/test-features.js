const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function load(relativeFile, extras = {}) {
  const context = {
    console,
    URL,
    setTimeout,
    clearTimeout,
    localStorage: createStorage(),
    ...extras,
  };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(
    fs.readFileSync(path.join(root, relativeFile), 'utf8'),
    context,
    { filename: relativeFile },
  );
  return context;
}

function loadInto(context, relativeFile) {
  vm.runInNewContext(
    fs.readFileSync(path.join(root, relativeFile), 'utf8'),
    context,
    { filename: relativeFile },
  );
  return context;
}

function testGpuCatalog() {
  const context = load('js/estimate.js');
  assert.ok(context.GPU_CATALOG.some((gpu) => gpu.vendor === 'NVIDIA'));
  assert.ok(context.GPU_CATALOG.some((gpu) => gpu.vendor === 'AMD'));
  assert.ok(context.GPU_CATALOG.some((gpu) => gpu.vendor === 'Intel'));
  assert.ok(context.GPU_CATALOG.some((gpu) => gpu.vendor === 'Apple Silicon'));
  assert.ok(context.GPU_CATALOG.some((gpu) => gpu.vram > 0));
}

function testModelNormalizationAndMerge() {
  const context = load('js/model-sync.js');
  const rows = context.ModelSync.normalizeSourceItems([
    { id: 'Qwen/Qwen3-8B', downloads: 10, lastModified: '2026-08-20T00:00:00Z' },
  ], 'Hugging Face');
  assert.equal(rows[0].id, 'Qwen/Qwen3-8B');
  assert.equal(rows[0].source, 'Hugging Face');
  assert.equal(rows[0].needsReview, true);
  assert.equal(context.ModelSync.mergeCatalog(rows, rows).length, 1);
}

async function testCustomGpuOverride() {
  const context = load('js/estimate.js', {
    navigator: {
      hardwareConcurrency: 8,
      deviceMemory: 16,
      platform: 'Win32',
      storage: { estimate: async () => ({ quota: 8 * 1024 ** 3 }) },
    },
    document: { createElement: () => ({ getContext: () => null }) },
  });
  loadInto(context, 'js/hardware.js');
  context.localStorage = createStorage({
    llmh_hw_v1: JSON.stringify({
      gpuChoice: 'other', gpuCustomName: 'Radeon Pro W7900', gpuKind: 'amd', gpuVram: 48, gpuBw: 300,
    }),
  });
  const hardware = await context.detectHardware();
  assert.equal(hardware.gpu.name, 'Radeon Pro W7900');
  assert.equal(hardware.gpu.kind, 'amd');
  assert.equal(hardware.gpuVram, 48);
}

async function testModelRefreshPartialFailure() {
  const cacheKey = 'llmh_model_catalog_v2';
  const cached = {
    entries: [{ id: 'cached/model', name: 'cached/model', source: 'cache', url: '#' }],
    updatedAt: '2026-08-19T00:00:00.000Z',
    sources: ['cache'],
  };
  const context = load('js/model-sync.js', {
    localStorage: createStorage({ [cacheKey]: JSON.stringify(cached) }),
    fetch: async (url) => {
      if (url.includes('huggingface.co')) {
        return { ok: true, json: async () => [{ id: 'live/model', tags: ['gguf'], downloads: 20 }] };
      }
      throw new Error('source unavailable');
    },
  });
  const result = await context.ModelSync.refresh({
    sources: [
      ['hf', 'Hugging Face', 'https://huggingface.co/api/models'],
      ['ms', 'ModelScope', 'https://modelscope.cn/openapi/v1/models'],
    ],
  });
  assert.ok(result.entries.some((entry) => entry.id === 'live/model'));
  assert.ok(result.failedSources.includes('ModelScope'));
}

function testGpuMatchingAndMemory() {
  const context = load('js/estimate.js');
  for (const [raw, name, bw] of [
    ['NVIDIA GeForce RTX 5070 Ti Laptop GPU', 'RTX 5070 Ti Laptop', 448],
    ['NVIDIA GeForce RTX 5070 Ti', 'RTX 5070 Ti', 896],
    ['NVIDIA GeForce RTX 5070', 'RTX 5070', 672],
    ['RTX 5070 Laptop GPU', 'RTX 5070 Laptop', 384],
  ]) {
    const gpu = context.matchGPU(raw);
    assert.equal(gpu.name, name);
    assert.equal(gpu.bw, bw);
  }
  assert.equal(context.matchGPU('RTX 50700'), null);
  const model = { params: 20, quant: { Q4_K_M: 10 } };
  for (const name of ['RTX 5060 Ti', 'RX 9060 XT']) {
    const gpu = context.matchGPU(name);
    assert.equal(gpu.name, name);
    assert.equal(gpu.vram, null);
    const hw = { gpu, ramGB: 64, cpuCores: 8, ramTier: 'ddr5-dual' };
    assert.equal(context.checkFit(model, 'Q4_K_M', hw).level, 'yellow');
    assert.match(context.checkFit(model, 'Q4_K_M', hw).reason, /手动确认/);
    assert.match(context.estSpeed(model, 'Q4_K_M', hw).note, /显存未知/);
    const eight = { ...hw, gpuVram: 8 };
    const sixteen = { ...hw, gpuVram: 16 };
    assert.equal(context.checkFit(model, 'Q4_K_M', eight).level, 'yellow');
    assert.equal(context.checkFit(model, 'Q4_K_M', sixteen).level, 'green');
    assert.equal(context.estSpeed(model, 'Q4_K_M', eight).mode, 'offload');
    assert.equal(context.estSpeed(model, 'Q4_K_M', sixteen).mode, 'gpu');
    assert.ok(context.estSpeed(model, 'Q4_K_M', eight).speed < context.estSpeed(model, 'Q4_K_M', sixteen).speed);
  }
  const overridden = { gpu: context.matchGPU('RTX 5070 Ti'), gpuVram: 8, ramGB: 64 };
  assert.equal(context.checkFit(model, 'Q4_K_M', overridden).level, 'yellow');
  assert.equal(context.estSpeed(model, 'Q4_K_M', overridden).mode, 'offload');
}

function testManualGpuMemoryUi() {
  const nodes = new Map();
  const element = () => ({
    value: '', textContent: '', innerHTML: '', style: {}, dataset: {}, children: [],
    appendChild(child) { this.children.push(child); },
  });
  const context = load('js/estimate.js', {
    document: {
      getElementById(id) {
        if (!nodes.has(id)) nodes.set(id, element());
        return nodes.get(id);
      },
      createElement: element,
      addEventListener() {},
    },
    saveOverride(value) { context.saved = value; },
  });
  loadInto(context, 'js/app.js');
  vm.runInNewContext('renderTable = function () {};', context);
  const model = { params: 20, quant: { Q4_K_M: 10 } };
  for (const name of ['RTX 5060 Ti', 'RX 9060 XT']) {
    context.testGpu = context.matchGPU(name);
    vm.runInNewContext('HW = { gpu: testGpu, gpuString: testGpu.name, ramGB: 64 }; renderSpecs(); showManual();', context);
    assert.match(nodes.get('spec-vram').textContent, /手动确认/);
    const options = nodes.get('manual-gpu').children.flatMap((group) => group.children || []);
    const option = options.find((entry) => entry.value === name);
    assert.ok(option);
    assert.match(option.textContent, /手动确认/);
    assert.doesNotMatch(option.textContent, /共享/);
    for (const choice of [name, '']) {
      for (const vram of [8, 16]) {
        nodes.get('manual-gpu').value = choice;
        if (choice) context.handleGpuSelectionChange();
        nodes.get('manual-vram').value = String(vram);
        context.applyManual();
        assert.equal(nodes.get('spec-vram').textContent, `${vram} GB`);
        assert.equal(context.saved.gpuVram, vram);
        const hw = vm.runInNewContext('HW', context);
        assert.equal(hw.gpu.name, name);
        assert.equal(context.checkFit(model, 'Q4_K_M', hw).level, vram === 8 ? 'yellow' : 'green');
        assert.equal(context.estSpeed(model, 'Q4_K_M', hw).mode, vram === 8 ? 'offload' : 'gpu');
      }
    }
  }
}

async function testPersistedGpuMemory() {
  const context = load('js/estimate.js', {
    navigator: { hardwareConcurrency: 8, deviceMemory: 64, platform: 'Win32' },
    document: { createElement: () => ({ getContext: () => null }) },
  });
  loadInto(context, 'js/hardware.js');
  const model = { params: 20, quant: { Q4_K_M: 10 } };
  for (const name of ['RTX 5060 Ti', 'RX 9060 XT']) {
    for (const vram of [8, 16]) {
      context.localStorage = createStorage({ llmh_hw_v1: JSON.stringify({ gpuChoice: name, gpuVram: vram }) });
      const hw = await context.detectHardware();
      assert.equal(hw.gpu.name, name);
      assert.equal(hw.gpuVram, vram);
      assert.equal(context.checkFit(model, 'Q4_K_M', hw).level, vram === 8 ? 'yellow' : 'green');
      assert.equal(context.estSpeed(model, 'Q4_K_M', hw).mode, vram === 8 ? 'offload' : 'gpu');
    }
  }
}

async function main() {
  testGpuCatalog();
  testGpuMatchingAndMemory();
  testManualGpuMemoryUi();
  await testPersistedGpuMemory();
  testModelNormalizationAndMerge();
  await testCustomGpuOverride();
  await testModelRefreshPartialFailure();
  console.log('PASS tests/test-features.js');
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
