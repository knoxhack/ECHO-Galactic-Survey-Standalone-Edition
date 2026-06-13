#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const DEFAULT_TEMPLATE = 'fixtures/galactic-survey/gameplay-qa/manual-evidence.template.json'
const DEFAULT_EVIDENCE = 'fixtures/galactic-survey/gameplay-qa/manual-evidence.json'
const NOTE_TEMPLATE_ROOT = 'fixtures/galactic-survey/gameplay-qa/evidence/templates'
const PATH_GROUPS = ['supportingFiles', 'screenshots', 'logs', 'saveSnapshots']

function parseArgs(argv) {
  const args = { root: process.cwd(), template: DEFAULT_TEMPLATE, evidence: DEFAULT_EVIDENCE, dryRun: false, force: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = () => {
      const value = argv[++index]
      if (!value) throw new Error(`${arg} requires a value`)
      return value
    }
    if (arg === '--root') args.root = path.resolve(next())
    else if (arg === '--template') args.template = next()
    else if (arg === '--evidence') args.evidence = next()
    else if (arg === '--dry-run') args.dryRun = true
    else if (arg === '--force') args.force = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return args
}

function resolveInside(root, relPath) {
  if (typeof relPath !== 'string' || relPath.trim() === '' || path.isAbsolute(relPath)) return { error: 'relative-path-required' }
  const base = path.resolve(root)
  const target = path.resolve(base, relPath)
  const relative = path.relative(base, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return { error: 'outside-root' }
  return { target }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

async function fileExists(filePath) {
  try {
    return (await fs.stat(filePath)).isFile()
  } catch {
    return false
  }
}

function noteTemplateFor(relPath) {
  if (!relPath.endsWith('.md')) return null
  return `${NOTE_TEMPLATE_ROOT}/${path.posix.parse(relPath.replace(/\\/g, '/')).name}.template.md`
}

function evidenceFromTemplate(template) {
  const claims = Object.fromEntries(Object.keys(template.claims ?? {}).map((claim) => [claim, false]))
  return {
    ...template,
    generatedAt: new Date().toISOString(),
    claims,
    notes: [
      ...(Array.isArray(template.notes) ? template.notes : []),
      'Initialized from template. Keep claims false until the referenced files are real playthrough evidence.'
    ]
  }
}

const args = parseArgs(process.argv.slice(2))
const root = path.resolve(args.root)
const blockers = []
const template = await readJson(path.join(root, args.template))
const directories = new Set()
const noteFiles = []

for (const group of PATH_GROUPS) {
  for (const relPath of template[group] ?? []) {
    const resolved = resolveInside(root, relPath)
    if (resolved.error) {
      blockers.push(`${group} path must stay inside the repo: ${relPath}`)
      continue
    }
    directories.add(path.relative(root, path.dirname(resolved.target)).replace(/\\/g, '/'))
    if (group !== 'supportingFiles') continue
    const templateRel = noteTemplateFor(relPath)
    if (!templateRel) continue
    const templateResolved = resolveInside(root, templateRel)
    if (templateResolved.error || !(await fileExists(templateResolved.target))) {
      blockers.push(`Missing note template for ${relPath}: ${templateRel}`)
      continue
    }
    noteFiles.push({
      path: relPath,
      template: templateRel,
      exists: await fileExists(resolved.target)
    })
  }
}

const evidenceTarget = resolveInside(root, args.evidence)
if (evidenceTarget.error) blockers.push(`Evidence path must stay inside the repo: ${args.evidence}`)
const evidenceExists = evidenceTarget.error ? false : await fileExists(evidenceTarget.target)
const willWriteEvidence = !evidenceTarget.error && (!evidenceExists || args.force)

const report = {
  schemaVersion: 'echo.galactic_survey.manual-evidence-init.v1',
  status: blockers.length ? 'BLOCKED' : 'PASS',
  mode: args.dryRun ? 'dry-run' : 'write',
  packId: template.packId,
  evidencePath: args.evidence,
  evidenceExists,
  willWriteEvidence,
  directories: [...directories].sort(),
  noteFiles: noteFiles.map((entry) => ({ ...entry, willWrite: !entry.exists })),
  blockers
}

if (!args.dryRun && report.status === 'PASS') {
  for (const directory of report.directories) await fs.mkdir(path.join(root, directory), { recursive: true })
  for (const noteFile of report.noteFiles) {
    if (!noteFile.willWrite) continue
    const target = resolveInside(root, noteFile.path).target
    const source = resolveInside(root, noteFile.template).target
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.copyFile(source, target)
  }
  if (willWriteEvidence) {
    await fs.mkdir(path.dirname(evidenceTarget.target), { recursive: true })
    await fs.writeFile(evidenceTarget.target, `${JSON.stringify(evidenceFromTemplate(template), null, 2)}\n`, 'utf8')
  }
}

console.log(JSON.stringify(report, null, 2))
if (report.status !== 'PASS') process.exitCode = 1
