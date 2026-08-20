/* ============================================================
 * 开源模型目录同步：多来源适配 + localStorage fallback
 * 只保存公开元数据，不上传本机硬件信息。
 * ============================================================ */
(function attachModelSync(root) {
  const CACHE_KEY = 'llmh_model_catalog_v2';
  const DEFAULT_SOURCES = [
    ['hf', 'Hugging Face', 'https://huggingface.co/api/models?pipeline_tag=text-generation&filter=gguf&sort=downloads&direction=-1&limit=24'],
    ['ms', 'ModelScope', 'https://modelscope.cn/openapi/v1/models?page_number=1&page_size=24'],
    ['github', 'GitHub', 'https://api.github.com/search/repositories?q=llm+GGUF+in:name,description&sort=updated&order=desc&per_page=24'],
  ];

  function sourceUrl(source, id, rawUrl) {
    if (rawUrl) return rawUrl;
    if (source === 'Hugging Face') return `https://huggingface.co/${id}`;
    if (source === 'ModelScope') return `https://modelscope.cn/models/${id}`;
    return `https://github.com/${id}`;
  }

  function normalizeSourceItems(items, source) {
    return (Array.isArray(items) ? items : []).map((item) => {
      const id = item.id || item.full_name || item.name;
      if (!id) return null;
      const isGithub = source === 'GitHub';
      const size = item.file_size || item.size || null;
      const params = item.params || item.num_parameters || null;
      return {
        id,
        name: item.display_name || item.name || id,
        source,
        url: sourceUrl(source, id, isGithub ? item.html_url : null),
        downloads: Number(item.downloads || item.stargazers_count || 0),
        lastModified: item.lastModified || item.last_modified || item.updated_at || item.created_at || null,
        size,
        params,
        description: item.description || '',
        needsReview: !size || !params,
      };
    }).filter(Boolean);
  }

  function mergeCatalog(...lists) {
    const map = new Map();
    lists.flat().forEach((entry) => {
      if (!entry || !entry.id) return;
      const key = `${entry.source || 'unknown'}:${entry.id}`;
      if (!map.has(key)) map.set(key, entry);
    });
    return [...map.values()].sort((a, b) => {
      const aTime = Date.parse(a.lastModified || '') || 0;
      const bTime = Date.parse(b.lastModified || '') || 0;
      return bTime - aTime;
    });
  }

  function loadCachedCatalog() {
    try {
      const cached = JSON.parse(root.localStorage.getItem(CACHE_KEY) || 'null');
      if (cached && Array.isArray(cached.entries)) return cached;
    } catch (error) { /* 损坏缓存按不存在处理 */ }
    return null;
  }

  function saveCachedCatalog(value) {
    try { root.localStorage.setItem(CACHE_KEY, JSON.stringify(value)); } catch (error) { /* 隐私模式可能禁用存储 */ }
  }

  async function fetchJson(url) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 12000) : null;
    try {
      const response = await root.fetch(url, {
        headers: { Accept: 'application/json' },
        signal: controller ? controller.signal : undefined,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function refresh(options = {}) {
    const sources = options.sources || DEFAULT_SOURCES;
    const settled = await Promise.all(sources.map(async ([key, label, url]) => {
      try {
        const payload = await fetchJson(url);
        const rawItems = key === 'github' ? payload.items : payload.data && payload.data.models ? payload.data.models : payload;
        const items = (Array.isArray(rawItems) ? rawItems : []).filter((item) => {
          if (key === 'hf') return (item.tags || []).includes('gguf') || /gguf/i.test(item.id || '');
          if (key === 'ms') return (item.tasks || []).some((task) => /text-generation|image-text-to-text|conversational/i.test(task));
          return /gguf|llama\.cpp|ollama|qwen|deepseek|local.?llm/i.test(`${item.name || ''} ${item.description || ''}`);
        });
        return { key, label, entries: normalizeSourceItems(items, label) };
      } catch (error) {
        return { key, label, entries: [], error: error.message || '请求失败' };
      }
    }));

    const cached = loadCachedCatalog();
    const successful = settled.filter((result) => !result.error);
    const liveEntries = successful.flatMap((result) => result.entries);
    const entries = mergeCatalog(liveEntries, cached ? cached.entries : []).slice(0, 120);
    const result = {
      entries,
      updatedAt: liveEntries.length ? new Date().toISOString() : (cached && cached.updatedAt) || null,
      sources: successful.map((result) => result.label),
      failedSources: settled.filter((result) => result.error).map((result) => result.label),
    };
    if (entries.length) saveCachedCatalog(result);
    return result;
  }

  root.ModelSync = {
    CACHE_KEY,
    DEFAULT_SOURCES,
    normalizeSourceItems,
    mergeCatalog,
    loadCachedCatalog,
    refresh,
  };
})(typeof window !== 'undefined' ? window : globalThis);
