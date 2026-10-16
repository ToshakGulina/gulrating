#!/usr/bin/env node
// Fast, dependency-free checks for the build-free ES-module application.
// Catches syntax errors, missing local imports, and missing named exports
// (the failure that once left the app stuck on its boot splash).
import { readdir, readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirs = ['src', 'functions'];
const modules = [];

async function walk(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (entry.isFile() && entry.name.endsWith('.js')) modules.push(full);
  }
}

for (const dir of sourceDirs) await walk(path.join(root, dir));
const errors = [];
const sources = new Map();
const exportsByFile = new Map();

for (const file of modules) {
  const source = await readFile(file, 'utf8');
  sources.set(file, source);
  const checked = spawnSync(process.execPath, ['--check', '--input-type=module'], {
    input: source,
    encoding: 'utf8'
  });
  if (checked.status !== 0) {
    errors.push(`${path.relative(root, file)}: syntax error\n${checked.stderr || checked.stdout}`);
  }

  const names = new Set();
  for (const match of source.matchAll(/\bexport\s+(?:async\s+)?(?:function|class|const|let|var)\s+([\w$]+)/g)) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(/\bexport\s*\{([^}]+)\}/g)) {
    for (const item of match[1].split(',')) {
      const value = item.trim().split(/\s+as\s+/).at(-1);
      if (value) names.add(value.trim());
    }
  }
  exportsByFile.set(file, names);
}

function resolveLocal(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const resolved = path.resolve(path.dirname(fromFile), specifier);
  if (path.extname(resolved)) return resolved;
  return `${resolved}.js`;
}

for (const [file, source] of sources) {
  // Static imports. Project modules keep import declarations terminated by semicolons.
  for (const match of source.matchAll(/^\s*import\s+([^;]+);/gm)) {
    const statement = match[1];
    const specifierMatch = statement.match(/\bfrom\s+['"]([^'"]+)['"]\s*$/);
    if (!specifierMatch) continue; // side-effect import; no local ones are required today
    const specifier = specifierMatch[1];
    const target = resolveLocal(file, specifier);
    if (!target) continue;
    try { await stat(target); }
    catch { errors.push(`${path.relative(root, file)}: missing module ${specifier}`); continue; }

    const named = statement.match(/\{([^}]+)\}/);
    if (!named) continue;
    const available = exportsByFile.get(target) || new Set();
    for (const item of named[1].split(',')) {
      const imported = item.trim().split(/\s+as\s+/)[0].trim();
      if (imported && !available.has(imported)) {
        errors.push(`${path.relative(root, file)}: ${specifier} does not export "${imported}"`);
      }
    }
  }

  // Literal dynamic imports, used for lazily opened screens.
  for (const match of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const target = resolveLocal(file, match[1]);
    if (!target) continue;
    try { await stat(target); }
    catch { errors.push(`${path.relative(root, file)}: missing dynamic module ${match[1]}`); }
  }
}

// Ensure the module entry referenced by the HTML exists.
const html = await readFile(path.join(root, 'index.html'), 'utf8');
for (const match of html.matchAll(/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/gi)) {
  const target = path.join(root, match[1].replace(/^\//, ''));
  try { await stat(target); }
  catch { errors.push(`index.html: missing module entry ${match[1]}`); }
}

if (errors.length) {
  console.error(errors.join('\n\n'));
  process.exit(1);
}
console.log(`Checked ${modules.length} JavaScript modules: syntax, local imports, named exports.`);
