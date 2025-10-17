const path = require('path');

function parseDurationPreference({ ms, s, defaultValue }) {
  const msValue = ms !== undefined ? Number.parseFloat(ms) : undefined;
  if (Number.isFinite(msValue) && msValue >= 0) {
    return msValue;
  }
  const sValue = s !== undefined ? Number.parseFloat(s) : undefined;
  if (Number.isFinite(sValue) && sValue >= 0) {
    return sValue * 1000;
  }
  return defaultValue;
}

function slugifyForClaudeProjects(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    return null;
  }
  const normalized = inputPath
    .replace(/\\/g, '/')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-');
  return normalized.startsWith('-') ? normalized : `-${normalized}`;
}

function generateClaudeProjectSlugCandidates(homeDir, workspaceDir) {
  const candidates = [];
  const normalizedWorkspace = (workspaceDir || '').replace(/\\/g, '/');
  const directSlug = slugifyForClaudeProjects(normalizedWorkspace);
  if (directSlug) {
    candidates.push(directSlug);
  }

  if (homeDir && workspaceDir) {
    const normalizedHome = homeDir.replace(/\\/g, '/');
    const emailSegment = path.basename(normalizedHome);
    const relative = path.relative(normalizedHome, workspaceDir);
    if (relative && !relative.startsWith('..')) {
      const posixRelative = relative.split(path.sep).join('/');
      const containerPath = `/app/user_projects/${emailSegment}/${posixRelative}`;
      const containerSlug = slugifyForClaudeProjects(containerPath);
      if (containerSlug && !candidates.includes(containerSlug)) {
        candidates.push(containerSlug);
      }
    }
  }

  return candidates;
}

function extractUniquePromptTexts(prompts) {
  if (!Array.isArray(prompts) || prompts.length === 0) {
    return [];
  }
  const seen = new Set();
  const results = [];
  for (const entry of prompts) {
    const text = typeof entry?.text === 'string' ? entry.text.trim() : '';
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    results.push(text);
  }
  return results;
}

function parseTimestamp(value) {
  if (!value) {
    return Date.now();
  }
  if (typeof value === 'number') {
    return value;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function getRootUserUuid(entry, entryIndex) {
  if (!entry) {
    return null;
  }
  if (entry.type === 'user' && entry.message?.role === 'user') {
    return entry.uuid || null;
  }

  let currentUuid = entry.parentUuid;
  let guard = 0;

  while (currentUuid && guard < 50) {
    const parent = entryIndex.get(currentUuid);
    if (!parent) {
      return null;
    }
    if (parent.type === 'user' && parent.message?.role === 'user') {
      return parent.uuid || null;
    }
    currentUuid = parent.parentUuid;
    guard += 1;
  }

  return null;
}

function entryHasToolUse(entry) {
  const content = entry?.message?.content;
  if (!Array.isArray(content)) {
    return false;
  }
  return content.some((part) => part?.type === 'tool_use');
}

function entryContainsToolResult(entry) {
  const content = entry?.message?.content;
  if (!Array.isArray(content)) {
    return false;
  }
  return content.some((part) => part?.type === 'tool_result');
}

function pushTextCandidate(target, value) {
  if (!value) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => pushTextCandidate(target, item));
    return;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      target.push(trimmed);
    }
  }
}

function extractAssistantText(entry) {
  const texts = [];
  const message = entry?.message || {};
  const content = message.content;

  if (Array.isArray(content)) {
    for (const part of content) {
      if (!part) {
        continue;
      }
      if (part.type === 'text') {
        pushTextCandidate(texts, part.text);
      } else if (part.type === 'output_text') {
        pushTextCandidate(texts, part.text ?? part.value);
      } else if (typeof part.value === 'string') {
        pushTextCandidate(texts, part.value);
      } else if (typeof part.text === 'string') {
        pushTextCandidate(texts, part.text);
      }
    }
  }

  pushTextCandidate(texts, message.text);
  pushTextCandidate(texts, entry?.output_text);
  pushTextCandidate(texts, entry?.content);
  pushTextCandidate(texts, message?.result);

  if (texts.length === 0) {
    return null;
  }

  return texts.join('\n').trim();
}

function getStopReason(entry) {
  const candidates = [
    entry?.stop_reason,
    entry?.stopReason,
    entry?.stop_sequence,
    entry?.stopSequence,
    entry?.message?.stop_reason,
    entry?.message?.stopReason,
    entry?.message?.stop_sequence,
    entry?.message?.stopSequence
  ];

  for (const value of candidates) {
    if (typeof value === 'string' && value.length > 0) {
      return value.toLowerCase();
    }
  }

  return null;
}

function deriveSessionIdFromFile(pathname) {
  if (!pathname) {
    return null;
  }
  const base = path.basename(pathname, '.jsonl');
  if (!base || base.length < 10) {
    return null;
  }
  return base;
}

module.exports = {
  parseDurationPreference,
  slugifyForClaudeProjects,
  generateClaudeProjectSlugCandidates,
  extractUniquePromptTexts,
  parseTimestamp,
  getRootUserUuid,
  entryHasToolUse,
  entryContainsToolResult,
  pushTextCandidate,
  extractAssistantText,
  getStopReason,
  deriveSessionIdFromFile
};
