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

async function main() {
  testGpuCatalog();
  testModelNormalizationAndMerge();
  await testCustomGpuOverride();
  await testModelRefreshPartialFailure();
  console.log('PASS tests/test-features.js');
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
