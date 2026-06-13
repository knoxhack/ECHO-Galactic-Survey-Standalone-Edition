#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const repoRoot = process.cwd()
const initScript = path.join(repoRoot, 'scripts', 'init-manual-gameplay-evidence.mjs')
const prepScript = path.join(repoRoot, 'scripts', 'prepare-manual-gameplay-capture.mjs')
const verifyScript = path.join(repoRoot, 'scripts', 'verify-manual-gameplay-evidence.mjs')
const importScript = path.join(repoRoot, 'scripts', 'import-manual-gameplay-capture.mjs')
const evidencePath = 'fixtures/galactic-survey/gameplay-qa/manual-evidence.json'
const templatePath = 'fixtures/galactic-survey/gameplay-qa/manual-evidence.template.json'
const releaseGateContractPath = 'fixtures/galactic-survey/gameplay-qa/release-gates.contract.json'
const noteTemplateRoot = 'fixtures/galactic-survey/gameplay-qa/evidence/templates'

function run(script, root, args = []) {
  return spawnSync(process.execPath, [script, '--root', root, ...args], { encoding: 'utf8', windowsHide: true })
}

async function sha256File(filePath) {
  const crypto = await import('node:crypto')
  return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex')
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
    'no-crash-review.template.md'
  ]) {
    const relPath = path.join(noteTemplateRoot, name)
    const target = path.join(root, relPath)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.copyFile(path.join(repoRoot, relPath), target)
  }
}

async function writeCaptureFiles(captureRoot) {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
  const zip = Buffer.from('504b03040a0000000000', 'hex')
  const files = new Map([
    ['fresh-world-notes.md', '# Fresh World\n\nReal captured fresh profile notes.\n'],
    ['first-30-minutes-notes.md', '# First 30 Minutes\n\nReal captured route notes.\n'],
    ['first-2-hours-notes.md', '# First 2 Hours\n\nReal captured systems notes.\n'],
    ['survey-array-verification.md', '# Survey Array\n\nReal captured Survey Array completion notes.\n'],
    ['no-crash-review.md', '# No Crash Review\n\nReal captured log review notes.\n'],
    ['logs/client-playthrough.log', '[10:30:00] [Render thread/INFO]: Galactic Survey real capture log clean\n'],
    ['screenshots/fresh-world-created.png', png],
    ['screenshots/first-30-minutes.png', png],
    ['screenshots/first-2-hours.png', png],
    ['screenshots/survey-array-complete.png', png],
    ['saves/first-30-minutes-save.zip', zip],
    ['saves/first-2-hours-save.zip', zip],
    ['saves/survey-array-save.zip', zip],
  ])
  for (const [relPath, content] of files) {
    const target = path.join(captureRoot, relPath)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content)
  }
}

async function writeArtifact(filePath) {
  const zip = Buffer.from('504b03040a0000000000', 'hex')
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, Buffer.concat([zip, Buffer.from('artifact bytes')]))
  const stat = await fs.stat(filePath)
  return { path: filePath, size: stat.size, sha256: await sha256File(filePath) }
}

async function writeDownloadEvidence(releaseIndexRoot, manifest, template, artifact) {
  const repoName = manifest.sourceRepo.split('/').pop()
  const localPath = path.relative(releaseIndexRoot, artifact.path).replace(/\\/g, '/')
  const report = {
    schemaVersion: 'echo.galactic_survey.draft-download.v1',
    status: 'PASS',
    data: {
      downloadRoot: 'tmp/galactic-survey-draft-download',
      editions: [
        {
          repoName,
          packId: manifest.packId,
          releaseTag: template.run.releaseTag,
          release: {
            htmlUrl: `https://example.invalid/${repoName}/releases/${template.run.releaseTag}`,
            draft: false,
            prerelease: true
          },
          downloadedAssets: [
            {
              name: template.run.artifactAsset,
              size: artifact.size,
              sha256: artifact.sha256,
              githubDigestSha256: artifact.sha256,
              browserDownloadUrl: `https://example.invalid/${template.run.artifactAsset}`,
              apiUrl: `https://example.invalid/api/${template.run.artifactAsset}`,
              state: 'uploaded',
              localPath
            }
          ]
        }
      ]
    }
  }
  const reportPath = path.join(releaseIndexRoot, 'release-readiness', 'galactic-survey-draft-download.json')
  await fs.mkdir(path.dirname(reportPath), { recursive: true })
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'galactic-survey-edition-evidence-tools-'))
try {
  await copySeedFiles(tmp)
  const dryRun = run(initScript, tmp, ['--dry-run'])
  assert.equal(dryRun.status, 0, `${dryRun.stdout}\n${dryRun.stderr}`)
  const dryRunReport = JSON.parse(dryRun.stdout)
  assert.equal(dryRunReport.status, 'PASS')
  assert.equal(dryRunReport.noteFiles.length, 5)

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

  const importTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'galactic-survey-edition-capture-import-'))
  try {
    await copySeedFiles(importTmp)
    const manifest = JSON.parse(await fs.readFile(path.join(importTmp, 'release-manifest.template.json'), 'utf8'))
    const template = JSON.parse(await fs.readFile(path.join(importTmp, templatePath), 'utf8'))
    const releaseIndexRoot = path.join(importTmp, 'fake-release-index')
    const artifactPath = path.join(releaseIndexRoot, 'tmp', 'galactic-survey-draft-download', manifest.sourceRepo.split('/').pop(), template.run.artifactAsset)
    const artifact = await writeArtifact(artifactPath)
    await writeDownloadEvidence(releaseIndexRoot, manifest, template, artifact)
    const captureRoot = path.join(importTmp, 'capture')
    const prepArgs = [
      '--release-index-root', releaseIndexRoot,
      '--capture-root', captureRoot,
      '--tester', 'CI capture tester',
      '--world-or-profile', 'Galactic Survey CI profile',
      '--started-at', '2026-06-13T10:30:00Z'
    ]
    const prepared = run(prepScript, importTmp, prepArgs)
    assert.equal(prepared.status, 0, `${prepared.stdout}\n${prepared.stderr}`)
    const prepReport = JSON.parse(prepared.stdout)
    assert.equal(prepReport.status, 'READY_FOR_CAPTURE')
    assert.equal(prepReport.artifact.matchesExpected, true)
    assert.ok(await fs.stat(path.join(captureRoot, 'capture-manifest.json')))
    assert.match(await fs.readFile(path.join(captureRoot, 'fresh-world-notes.md'), 'utf8'), /ECHO_GALACTIC_SURVEY_TEMPLATE_ONLY/u)

    const importArgs = [
      '--capture-root', captureRoot,
      '--artifact', artifactPath,
      '--tester', 'CI capture tester',
      '--world-or-profile', 'Galactic Survey CI profile',
      '--started-at', '2026-06-13T10:30:00Z',
    ]
    const scaffoldImport = run(importScript, importTmp, ['--dry-run', ...importArgs])
    assert.equal(scaffoldImport.status, 1)
    assert.match(`${scaffoldImport.stdout}\n${scaffoldImport.stderr}`, /template marker|capture file missing/u)

    await writeCaptureFiles(captureRoot)
    const dryImport = run(importScript, importTmp, ['--dry-run', ...importArgs])
    assert.equal(dryImport.status, 0, `${dryImport.stdout}\n${dryImport.stderr}`)
    const dryImportReport = JSON.parse(dryImport.stdout)
    assert.equal(dryImportReport.status, 'PASS')
    assert.equal(dryImportReport.copyPlan.length, 13)

    const imported = run(importScript, importTmp, importArgs)
    assert.equal(imported.status, 0, `${imported.stdout}\n${imported.stderr}`)
    const importReport = JSON.parse(imported.stdout)
    assert.equal(importReport.status, 'PASS')

    const importedEvidence = JSON.parse(await fs.readFile(path.join(importTmp, evidencePath), 'utf8'))
    assert.ok(Object.values(importedEvidence.claims).every((claim) => claim === true))
    assert.ok(importedEvidence.releaseGates.every((gate) => gate.satisfied === true && gate.evidenceSource !== 'template'))
    assert.equal(importedEvidence.run.tester, 'CI capture tester')
    assert.match(importedEvidence.run.artifactSha256, /^[a-f0-9]{64}$/u)
    assert.ok(importedEvidence.run.artifactSize > 0)
    assert.equal(importedEvidence.run.expectedArtifactSha256, artifact.sha256)
    assert.equal(importedEvidence.run.expectedArtifactSize, artifact.size)
    assert.equal(importedEvidence.run.artifactMatchesExpected, true)

    const releaseReady = run(verifyScript, importTmp, ['--require-release-ready'])
    assert.equal(releaseReady.status, 0, `${releaseReady.stdout}\n${releaseReady.stderr}`)

    const overwriteBlocked = run(importScript, importTmp, importArgs)
    assert.equal(overwriteBlocked.status, 1)
    assert.match(`${overwriteBlocked.stdout}\n${overwriteBlocked.stderr}`, /already exists; pass --force/u)
  } finally {
    await fs.rm(importTmp, { recursive: true, force: true })
  }
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}

console.log('Galactic Survey edition gameplay evidence tools passed.')
