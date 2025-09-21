const fs = require('fs').promises;
const path = require('path');

const contentTypeByExtension = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

const resolveContentType = (filePath, fallback = 'text/plain; charset=utf-8') => {
  const ext = path.extname(filePath || '').toLowerCase();
  return contentTypeByExtension[ext] || fallback;
};

const injectBaseTag = (html, baseHref) => {
  if (!baseHref) {
    return html;
  }

  if (!/<base\s+/i.test(html)) {
    const baseTag = `<base href="${baseHref}">`;
    if (/<head\b[^>]*>/i.test(html)) {
      return html.replace(/<head\b([^>]*)>/i, `<head$1>\n    ${baseTag}`);
    }
    return `${baseTag}\n${html}`;
  }

  return html;
};

const isRelativePath = (url) => {
  if (!url) return false;
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('?')) {
    return false;
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('mailto:') || lower.startsWith('tel:')) {
    return false;
  }

  return !/^([a-z][a-z0-9+.-]*:|\/\/|data:)/i.test(trimmed) && !trimmed.startsWith('//');
};

const appendTokenToUrl = (url, token) => {
  if (!token || !isRelativePath(url)) {
    return url;
  }

  const [pathPart, hashPart] = url.split('#');
  const [basePart, queryPart] = pathPart.split('?');

  const params = new URLSearchParams(queryPart || '');
  if (!params.has('token')) {
    params.append('token', token);
  }

  const queryString = params.toString();
  const rebuilt = queryString ? `${basePart}?${queryString}` : basePart;
  return hashPart ? `${rebuilt}#${hashPart}` : rebuilt;
};

const appendTokenToAssets = (html, token) => {
  if (!token) {
    return html;
  }

  return html
    .replace(/(<link[^>]+href=")([^"]+)("[^>]*>)/gi, (match, prefix, url, suffix) => {
      const updatedUrl = appendTokenToUrl(url, token);
      return `${prefix}${updatedUrl}${suffix}`;
    })
    .replace(/(<script[^>]+src=")([^"]+)("[^>]*>)/gi, (match, prefix, url, suffix) => {
      const updatedUrl = appendTokenToUrl(url, token);
      return `${prefix}${updatedUrl}${suffix}`;
    })
    .replace(/(<img[^>]+src=")([^"]+)("[^>]*>)/gi, (match, prefix, url, suffix) => {
      const updatedUrl = appendTokenToUrl(url, token);
      return `${prefix}${updatedUrl}${suffix}`;
    })
    .replace(/(<a[^>]+href=")([^"]+)("[^>]*>)/gi, (match, prefix, url, suffix) => {
      const updatedUrl = appendTokenToUrl(url, token);
      return `${prefix}${updatedUrl}${suffix}`;
    });
};

const enhanceHtmlForPreview = (html, baseHref, token) => {
  let updatedHtml = injectBaseTag(html, baseHref);
  updatedHtml = appendTokenToAssets(updatedHtml, token);
  return updatedHtml;
};

const serveProjectAsset = async ({
  projectRoot,
  requestedPath,
  projectId,
  token,
  res,
  db,
  baseHref
}) => {
  const safeRequestedPath = requestedPath || 'index.html';
  const absolutePath = path.normalize(path.join(projectRoot, safeRequestedPath));

  if (!absolutePath.startsWith(projectRoot)) {
    res.status(400).send('<h1>Invalid file path</h1>');
    return;
  }

  try {
    const fileBuffer = await fs.readFile(absolutePath);
    const contentType = resolveContentType(safeRequestedPath, 'application/octet-stream');

    if (contentType.startsWith('text/html')) {
      const html = fileBuffer.toString('utf8');
      res.setHeader('Content-Type', contentType);
      res.send(enhanceHtmlForPreview(html, baseHref, token));
      return;
    }

    res.setHeader('Content-Type', contentType);
    res.send(fileBuffer);
    return;
  } catch (fsError) {
    try {
      const [files] = await db.execute(
        'SELECT content, file_type, file_path FROM project_files WHERE project_id = ? AND file_path = ?',
        [projectId, safeRequestedPath]
      );

      if (files.length === 0) {
        res.status(404).send('<h1>File not found</h1>');
        return;
      }

      const file = files[0];
      const contentType = resolveContentType(
        file.file_path || safeRequestedPath,
        file.file_type === 'html' ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8'
      );

      if (contentType.startsWith('text/html')) {
        res.setHeader('Content-Type', contentType);
        res.send(enhanceHtmlForPreview(file.content, baseHref, token));
        return;
      }

      res.setHeader('Content-Type', contentType);
      res.send(file.content);
      return;
    } catch (dbError) {
      console.error('Error loading file from database:', dbError);
      res.status(500).send('<h1>Error loading project file</h1>');
    }
  }
};

module.exports = {
  resolveContentType,
  enhanceHtmlForPreview,
  serveProjectAsset
};
