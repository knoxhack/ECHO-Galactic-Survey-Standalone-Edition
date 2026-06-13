#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const repoRoot = process.cwd()
const initScript = path.join(repoRoot, 'scripts', 'init-manual-gameplay-evidence.mjs')
const verifyScript = path.join(repoRoot, 'scripts', 'verify-manual-gameplay-evidence.mjs')
const evidencePath = 'fixtures/galactic-survey/gameplay-qa/manual-evidence.json'
const templatePath = 'fixtures/galactic-survey/gameplay-qa/manual-evidence.template.json'
const releaseGateContractPath = 'fixtures/galactic-survey/gameplay-qa/release-gates.contract.json'
const noteTemplateRoot = 'fixtures/galactic-survey/gameplay-qa/evidence/templates'

function run(script, root, args = []) {
  return spawnSync(process.execPath, [script, '--root', root, ...args], { encoding: 'utf8', windowsHide: true })
}

async function copySeedFiles(root) {
  await fs.mkdir(path.join(root, 'fixtures/galactic-survey/gameplay-qa'), { recursive: true })
  await fs.copyFile(path.join(repoRoot, 'release-manifest.template.json'), path.join(root, 'release-manifest.template.json'))
  await fs.copyFile(path.join(repoRoot, templatePath), path.join(root, templatePath))
  await fs.copyFile(path.join(repoRoot, releaseGateContractPath), path.join(root, releaseGateContractPath))
  for (const name of [
    'fresh-world-notes.template.md',
    'first-30-minutes-notes.template.md',
    'first-2-hours-notes.template.md',
    'survey-array-verification.template.md',
    'launcher-flow-review.template.md',
    'no-crash-review.template.md'
  ]) {
    const relPath = path.join(noteTemplateRoot, name)
    const target = path.join(root, relPath)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.copyFile(path.join(repoRoot, relPath), target)
  }
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'galactic-survey-edition-evidence-tools-'))
try {
  await copySeedFiles(tmp)
  const dryRun = run(initScript, tmp, ['--dry-run'])
  assert.equal(dryRun.status, 0, `${dryRun.stdout}\n${dryRun.stderr}`)
  const dryRunReport = JSON.parse(dryRun.stdout)
  assert.equal(dryRunReport.status, 'PASS')
  assert.equal(dryRunReport.noteFiles.length, 6)

  const init = run(initScript, tmp)
  assert.equal(init.status, 0, `${init.stdout}\n${init.stderr}`)
  const initReport = JSON.parse(init.stdout)
  assert.equal(initReport.status, 'PASS')
  assert.equal(initReport.willWriteEvidence, true)

  const initializedEvidence = JSON.parse(await fs.readFile(path.join(tmp, evidencePath), 'utf8'))
  assert.ok(Object.values(initializedEvidence.claims).every((claim) => claim === false))
  assert.ok(initializedEvidence.releaseGates.every((gate) => gate.satisfied === false && gate.evidenceSource === 'template'))

  const templateOnly = run(verifyScript, tmp, ['--template-only'])
  assert.equal(templateOnly.status, 0, `${templateOnly.stdout}\n${templateOnly.stderr}`)

  const blocked = run(verifyScript, tmp, ['--require-release-ready'])
  assert.equal(blocked.status, 1)
  assert.match(`${blocked.stdout}\n${blocked.stderr}`, /manualEvidence claim realFirst30Playthrough must be true|missing file/u)
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}

console.log('Galactic Survey edition gameplay evidence tools passed.')
