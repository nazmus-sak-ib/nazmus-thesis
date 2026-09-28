import { readdir, readFile, lstat } from 'node:fs/promises';
import path from 'node:path';

const catalogFile = 'model-library.json';
const directories = { image: ['models', '.svg'], results: ['results', '.json'] };

async function listFiles(root, kind, warnings) {
  const [folder, extension] = directories[kind];
  let entries;
  try { entries = await readdir(path.join(root, folder), { withFileTypes: true }); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    warnings.push('web/' + folder + ' is missing. Restore or create that folder.');
    return [];
  }
  return entries.filter(entry => entry.isFile() && path.extname(entry.name).toLowerCase() === extension)
    .map(entry => ({ id: entry.name.slice(0, -extension.length), name: entry.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Every refresh is a fresh directory scan. No models.json is read or written.
// Matching uses the exact filename stem, including case, on all platforms.
export async function scanModelLibrary(root, mode = 'live') {
  const warnings = [];
  const [images, results] = await Promise.all([
    listFiles(root, 'image', warnings), listFiles(root, 'results', warnings)
  ]);
  const groups = new Map();
  for (const [kind, files] of [['image', images], ['results', results]]) {
    for (const file of files) {
      if (!groups.has(file.id)) groups.set(file.id, { image: [], results: [] });
      groups.get(file.id)[kind].push(file.name);
    }
  }
  const models = [], broken = [];
  for (const [id, files] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const entry = { id, title: id, image: files.image.length > 0, results: files.results.length > 0,
      imageFiles: files.image, resultFiles: files.results };
    if (files.image.length !== 1 || files.results.length !== 1) {
      entry.reason = !entry.image ? 'Missing SVG' : !entry.results ? 'Missing JSON' : 'Duplicate filenames for this model ID';
      broken.push(entry);
      continue;
    }
    let data;
    try {
      const text = await readFile(path.join(root, 'results', files.results[0]), 'utf8');
      data = JSON.parse(text.replace(/^\uFEFF/, ''));
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new SyntaxError('Expected a result object');
    } catch (error) {
      if (error instanceof SyntaxError) {
        broken.push({ ...entry, reason: 'JSON is invalid or incomplete. Finish exporting it, then refresh.' });
        continue;
      }
      // A failed read or a file disappearing mid-scan is not evidence that the
      // whole library was removed. Abort and let the frontend keep its state.
      throw error;
    }
    const title = typeof data.metadata?.model_name === 'string' && data.metadata.model_name.trim()
      ? data.metadata.model_name : 'Model ' + id;
    models.push({ id, title, image: 'models/' + encodeURIComponent(files.image[0]),
      results: 'results/' + encodeURIComponent(files.results[0]) });
  }
  return { schema_version: '1.0', source: 'folder-scan', mode, models, broken, warnings };
}

export default function modelLibraryPlugin() {
  let root, basePath = '/';
  const send = (res, status, type, body, head = false) => {
    res.statusCode = status;
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(head ? undefined : body);
  };
  const middleware = async (req, res, next) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    // Vite may have stripped the configured base before invoking middleware.
    const relative = pathname.startsWith(basePath) ? pathname.slice(basePath.length) : pathname.slice(1);
    const match = /^(models|results)\/([^/]+)$/.exec(relative);
    if (relative !== catalogFile && !match) return next();
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.setHeader('Allow', 'GET, HEAD');
      return send(res, 405, 'text/plain', 'Method not allowed');
    }
    try {
      if (relative === catalogFile) {
        const catalog = await scanModelLibrary(root);
        return send(res, 200, 'application/json; charset=utf-8', JSON.stringify(catalog), req.method === 'HEAD');
      }
      const name = decodeURIComponent(match[2]), folder = match[1];
      const extension = folder === 'models' ? '.svg' : '.json';
      if (!name || name.includes('/') || name.includes('\\') || name.includes('\0') || path.extname(name).toLowerCase() !== extension) {
        return send(res, 404, 'text/plain', 'File not found');
      }
      const file = path.join(root, folder, name);
      // Serve only ordinary files in these two directories, never symlinks.
      if (!(await lstat(file)).isFile()) return send(res, 404, 'text/plain', 'File not found');
      const contents = req.method === 'HEAD' ? '' : await readFile(file);
      return send(res, 200, folder === 'models' ? 'image/svg+xml' : 'application/json; charset=utf-8', contents, req.method === 'HEAD');
    } catch (error) {
      if (match && error.code === 'ENOENT') return send(res, 404, 'text/plain', 'File not found');
      if (error instanceof URIError) return send(res, 400, 'text/plain', 'Invalid file path');
      return send(res, 503, 'application/json', JSON.stringify({ error: 'Could not finish scanning or reading model files. The library was not refreshed; retry after file operations finish.' }));
    }
  };
  return {
    name: 'folder-model-library',
    configResolved(config) {
      root = config.root;
      basePath = new URL(config.base, 'http://localhost').pathname;
      if (!basePath.endsWith('/')) basePath += '/';
    },
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
    async generateBundle() {
      const catalog = await scanModelLibrary(root, 'build');
      this.emitFile({ type: 'asset', fileName: catalogFile, source: JSON.stringify(catalog, null, 2) });
      for (const model of catalog.models) {
        for (const key of ['image', 'results']) {
          const filename = decodeURIComponent(model[key]);
          this.emitFile({ type: 'asset', fileName: filename, source: await readFile(path.join(root, filename)) });
        }
      }
    }
  };
}
