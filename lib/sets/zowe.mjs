// SPDX-License-Identifier: AGPL-3.0-or-later
// Zowe team configuration and the MCP client configuration that launches the Zowe MCP server: where
// a mainframe credential, a TLS setting or an agent's authority is written into the repository.
// docs/spec/evidence.md §13.1. A finding names the file, the profile or server and the key, never
// the value.
import { basename } from 'node:path';
import { relPath } from '../sources.mjs';
import { report } from '../kernel/ruleset.mjs';
import { treeFor, noteUnread } from '../kernel/source-tree.mjs';
import { eachWithinMemory } from '../kernel/memory.mjs';

export const ZOWE_RULES = {
  'zowe-config-secret-in-clear': {
    sev: 'high', evidence: 'construct', cwe: 'CWE-256',
    text: 'A Zowe team configuration holds a password or token in the file rather than in the credential vault',
    impact: 'Anyone who can read the repository or a copy of it can log on to the mainframe as that user',
    remedy: 'Remove the value from properties and list the key in the profile\'s secure array, so Zowe keeps it in the operating system\'s credential vault',
  },
  'zowe-config-tls-verify-off': {
    sev: 'med', evidence: 'construct', cwe: 'CWE-295',
    text: 'A Zowe profile turns off TLS certificate verification',
    impact: 'Anyone on the network path can present their own certificate and read or change the traffic to the mainframe, logon included',
    remedy: 'Set rejectUnauthorized to true and install the certificate authority that signed the mainframe\'s certificate',
  },
  'zowe-config-cleartext': {
    sev: 'med', evidence: 'construct', cwe: 'CWE-319',
    text: 'A Zowe profile for z/OSMF, API ML or RSE connects over plain HTTP',
    impact: 'The logon and the data cross the network in cleartext',
    remedy: 'Set protocol to https',
  },
  'zowe-mcp-password-in-config': {
    sev: 'high', evidence: 'construct', cwe: 'CWE-798',
    text: 'An MCP client configuration sets a Zowe MCP password, credential map or key passphrase to a literal value',
    impact: 'Anyone who can read the configuration can log on to the mainframe as the user the agent acts for',
    remedy: 'Replace the literal with a reference such as ${env:NAME} and keep the value in the environment or a secrets manager',
  },
  'zowe-mcp-tier-writes': {
    sev: 'med', evidence: 'construct', cwe: 'CWE-250',
    text: 'A Zowe MCP server runs at a capability tier that lets the agent change or delete mainframe data',
    impact: 'The agent can write, update or delete data sets and members as the user it logs on as, without a person approving each change',
    remedy: 'Run at read-strict or read unless write access is reviewed and needed; grant update or delete for the task that needs it',
  },
  'zowe-mcp-tier-full': {
    sev: 'high', evidence: 'construct', cwe: 'CWE-250',
    text: 'A Zowe MCP server runs at the full capability tier',
    impact: 'The agent can submit jobs and run commands on the mainframe as the user it logs on as, so text an attacker places where the agent reads it can run work on the system',
    remedy: 'Run at read-strict or read; give job submission to a separate, reviewed path',
  },
  'zowe-mcp-data-marking-off': {
    sev: 'med', evidence: 'construct', cwe: 'CWE-1427',
    text: 'A Zowe MCP server has its untrusted-data marking turned off',
    impact: 'Data read from the mainframe reaches the agent unmarked, so instructions planted in a data set, job output or member are not flagged as data',
    remedy: 'Remove ZOWE_MCP_DATA_MARKING=0 so the default marking applies',
  },
  'zowe-mcp-unpinned': {
    sev: 'low', evidence: 'construct', cwe: 'CWE-829',
    text: 'A Zowe MCP server is launched by npx with no pinned version',
    impact: 'Whatever version the registry serves next runs with the agent\'s mainframe credentials',
    remedy: 'Pin the version: npx @zowe/mcp-server@<version>',
  },
  'zowe-mock-credentials': {
    sev: 'med', evidence: 'construct', cwe: 'CWE-798',
    text: 'A Zowe MCP mock systems.json holds a password',
    impact: 'A password in mock data is often a real one copied in, and anyone who can read the repository has it',
    remedy: 'Remove the password from the mock data or replace it with a placeholder',
  },
};

// JSON with comments and trailing commas, as VS Code settings and Zowe team configurations allow.
function stripJsonc(text) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (c === '\\') out += text[++i] ?? '';
      else if (c === '"') inStr = false;
    } else if (c === '"') { inStr = true; out += c; }
    else if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; }
    else if (c === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) { if (text[i] === '\n') out += '\n'; i++; } i++; }
    else if (c === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] !== '}' && text[j] !== ']') out += c;
    } else out += c;
  }
  return out;
}

// The line of `"key"` after the first `"anchor"`, or of the first `"key"` in the file.
function lineOf(text, key, anchor = null) {
  const from = anchor ? Math.max(0, text.indexOf(`"${anchor}"`)) : 0;
  let idx = text.indexOf(`"${key}"`, from);
  if (idx < 0) idx = text.indexOf(`"${key}"`);
  return idx < 0 ? 1 : text.slice(0, idx).split('\n').length;
}

const isReference = (v) => typeof v === 'string' && /^\$\{(?:env:|input:)?[A-Za-z_][A-Za-z0-9_]*\}$/.test(v);

function kindOf(rel) {
  const base = basename(rel);
  const parts = rel.split('/');
  const parent = parts.length > 1 ? parts[parts.length - 2] : '';
  if (base === 'zowe.config.json' || base === 'zowe.config.user.json') return 'team';
  if (base === '.mcp.json' || base === 'claude_desktop_config.json') return 'mcp';
  if (base === 'mcp.json' && (parent === '.vscode' || parent === '.cursor')) return 'mcp';
  if ((base === 'settings.json' || base === 'settings.local.json') && parent === '.claude') return 'mcp';
  if (base === 'settings.json' && parent === '.gemini') return 'mcp';
  if (base === 'settings.json' && parent === '.vscode') return 'vscode';
  if (base === 'systems.json' && parts.slice(0, -1).some((p) => /mock/i.test(p))) return 'mock';
  return null;
}

function eachProfile(profiles, prefix, fn) {
  if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) return;
  for (const [name, profile] of Object.entries(profiles)) {
    if (!profile || typeof profile !== 'object') continue;
    const path = prefix ? `${prefix}.${name}` : name;
    fn(profile, path, name);
    eachProfile(profile.profiles, path, fn);
  }
}

function teamConfig(config, raw, rel, findings) {
  eachProfile(config.profiles, '', (profile, name, leaf) => {
    const props = profile.properties && typeof profile.properties === 'object' ? profile.properties : {};
    const secure = Array.isArray(profile.secure) ? profile.secure : [];
    for (const key of ['password', 'tokenValue', 'authToken']) {
      if (typeof props[key] === 'string' && props[key] && !secure.includes(key)) {
        findings.push({ rule: 'zowe-config-secret-in-clear', path: rel, line: lineOf(raw, key, leaf), detail: `profile ${name} holds properties.${key} in the file, and its secure array does not list it` });
      }
    }
    if (props.rejectUnauthorized === false) findings.push({ rule: 'zowe-config-tls-verify-off', path: rel, line: lineOf(raw, 'rejectUnauthorized', leaf), detail: `profile ${name} sets rejectUnauthorized to false` });
    if (['zosmf', 'apiml', 'rse'].includes(String(profile.type)) && String(props.protocol).toLowerCase() === 'http') {
      findings.push({ rule: 'zowe-config-cleartext', path: rel, line: lineOf(raw, 'protocol', leaf), detail: `profile ${name} (type ${profile.type}) connects over http` });
    }
  });
}

const isZoweServer = (s) => s && typeof s === 'object' && /@zowe\/mcp-server|zowe-mcp/.test([s.command, ...(Array.isArray(s.args) ? s.args : [])].map(String).join(' '));

function tierOf(server) {
  const args = Array.isArray(server.args) ? server.args.map(String) : [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--capability-tier' && i + 1 < args.length) return args[i + 1];
    if (args[i].startsWith('--capability-tier=')) return args[i].slice('--capability-tier='.length);
  }
  const env = server.env && typeof server.env === 'object' ? server.env : {};
  return typeof env.ZOWE_MCP_CAPABILITY_TIER === 'string' ? env.ZOWE_MCP_CAPABILITY_TIER : null;
}

function tierFinding(tier, rel, line, where) {
  if (tier === 'full') return { rule: 'zowe-mcp-tier-full', path: rel, line, detail: `${where} runs at capability tier full` };
  if (tier === 'update' || tier === 'delete') return { rule: 'zowe-mcp-tier-writes', path: rel, line, detail: `${where} runs at capability tier ${tier}` };
  return null;
}

function mcpConfig(config, raw, rel, findings) {
  const servers = config.mcpServers || config.servers || {};
  if (!servers || typeof servers !== 'object') return;
  for (const [name, server] of Object.entries(servers)) {
    if (!isZoweServer(server)) continue;
    const env = server.env && typeof server.env === 'object' ? server.env : {};
    for (const [key, value] of Object.entries(env)) {
      if ((key === 'ZOWE_MCP_CREDENTIALS' || key.startsWith('ZOWE_MCP_PASSWORD_') || key.startsWith('ZOWE_MCP_KEY_PASSPHRASE_')) && value !== '' && !isReference(value)) {
        findings.push({ rule: 'zowe-mcp-password-in-config', path: rel, line: lineOf(raw, key, name), detail: `server ${name} sets ${key} to a literal value` });
      }
    }
    const t = tierFinding(tierOf(server), rel, lineOf(raw, 'capability-tier', name) || lineOf(raw, 'ZOWE_MCP_CAPABILITY_TIER', name), `server ${name}`);
    if (t) findings.push(t);
    if (String(env.ZOWE_MCP_DATA_MARKING) === '0') findings.push({ rule: 'zowe-mcp-data-marking-off', path: rel, line: lineOf(raw, 'ZOWE_MCP_DATA_MARKING', name), detail: `server ${name} sets ZOWE_MCP_DATA_MARKING to 0` });
    if (String(server.command) === 'npx') {
      const pkg = (Array.isArray(server.args) ? server.args.map(String) : []).find((a) => a.startsWith('@zowe/mcp-server'));
      if (pkg && (pkg === '@zowe/mcp-server' || pkg === '@zowe/mcp-server@latest')) findings.push({ rule: 'zowe-mcp-unpinned', path: rel, line: lineOf(raw, pkg, name), detail: `server ${name} runs ${pkg} through npx` });
    }
  }
}

function vscodeSettings(config, raw, rel, findings) {
  const tier = config['zoweMCP.capabilityTier'];
  const t = typeof tier === 'string' ? tierFinding(tier, rel, lineOf(raw, 'zoweMCP.capabilityTier'), 'the VS Code setting zoweMCP.capabilityTier') : null;
  if (t) findings.push(t);
}

function passwordPaths(value, path, out) {
  if (Array.isArray(value)) value.forEach((v, i) => passwordPaths(v, `${path}[${i}]`, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const p = path ? `${path}.${k}` : k;
      if (/^password$/i.test(k) && typeof v === 'string' && v) out.push(p);
      else passwordPaths(v, p, out);
    }
  }
  return out;
}

function mockSystems(config, raw, rel, findings) {
  for (const p of passwordPaths(config, '', [])) findings.push({ rule: 'zowe-mock-credentials', path: rel, line: lineOf(raw, 'password'), detail: `the mock systems file holds a password at ${p}` });
}

const READERS = { team: teamConfig, mcp: mcpConfig, vscode: vscodeSettings, mock: mockSystems };

export function scanZowe(root, opts = {}) {
  const tree = treeFor(root, opts);
  const findings = [];
  const stats = { filesScanned: 0, filesUnreadable: 0, filesUnparsed: 0 };
  const files = tree.list().filter((f) => kindOf(relPath(root, f)));
  const run = eachWithinMemory(files, (f) => {
    const rel = relPath(root, f);
    let raw;
    try { raw = tree.text(f).text; } catch (e) { noteUnread(stats, tree, f, e); return 0; }
    let config;
    try { config = JSON.parse(stripJsonc(raw)); } catch { stats.filesUnparsed++; return raw.length; }
    stats.filesScanned++;
    if (config && typeof config === 'object') READERS[kindOf(rel)](config, raw, rel, findings);
    return raw.length;
  }, { label: 'zowe', maxBytes: opts.maxSourceBytes ?? Infinity });
  return report('zowe', { rules: ZOWE_RULES, findings, stats, run });
}
