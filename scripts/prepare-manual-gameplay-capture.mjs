#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const DEFAULT_TEMPLATE = 'fixtures/galactic-survey/gameplay-qa/manual-evidence.template.json'
const DEFAULT_DOWNLOAD_EVIDENCE = 'release-readiness/galactic-survey-draft-download.json'
const EVIDENCE_ROOT = 'fixtures/galactic-survey/gameplay-qa/evidence'
const TEMPLATE_MARKER = 'ECHO_GALACTIC_SURVEY_TEMPLATE_ONLY'
const REQUIRED_OPTIONS = ['tester', 'worldOrProfile', 'startedAt']

function usage() {
  return `Usage: node scripts/prepare-manual-gameplay-capture.mjs --tester <name> --world-or-profile <name> --started-at <iso> [options]

Prepares a fail-closed Galactic Survey manual gameplay capture folder. The
folder is tied to the Release Index downloaded public prerelease artifact and
contains note templates plus a capture-manifest.json. It does not create fake
screenshots, logs, or save snapshots.

Options:
  --root <path>                Edition repo root. Default: current directory.
  --template <path>            Evidence template path.
  --release-index-root <path>  Release Index root. Default: sibling ECHO-Release-Index.
  --download-evidence <path>   Release Index download evidence report.
  --capture-root <path>        Output capture folder. Default: tmp/galactic-survey-gameplay-capture/<packId>/<timestamp>.
  --artifact <path>            Downloaded pack artifact. Default: asset localPath from download evidence.
  --tester <name>              Tester or device/run identifier.
  --world-or-profile <name>    World/profile name used for the run.
  --started-at <iso>           Real run start timestamp.
  --installed-from <text>      Install source. Default: ECHO Launcher.
  --force                      Allow writing into an existing capture folder.
  --help                       Print this help text.
`
}

function parseArgs(argv) {
  const args = {
    root: process.cwd(),
    template: DEFAULT_TEMPLATE,
    releaseIndexRoot: '',
    downloadEvidence: DEFAULT_DOWNLOAD_EVIDENCE,
    captureRoot: '',
    artifact: '',
    tester: '',
    worldOrProfile: '',
    startedAt: '',
    installedFrom: 'ECHO Launcher',
    force: false,
    help: false
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = () => {
      const value = argv[++index]
      if (!value) throw new Error(`${arg} requires a value`)
      return value
    }
    if (arg === '--root') args.root = path.resolve(next())
    else if (arg === '--template') args.template = next()
    else if (arg === '--release-index-root') args.releaseIndexRoot = path.resolve(next())
    else if (arg === '--download-evidence') args.downloadEvidence = next()
    else if (arg === '--capture-root') args.captureRoot = path.resolve(next())
    else if (arg === '--artifact') args.artifact = path.resolve(next())
    else if (arg === '--tester') args.tester = next()
    else if (arg === '--world-or-profile') args.worldOrProfile = next()
    else if (arg === '--started-at') args.startedAt = next()
    else if (arg === '--installed-from') args.installedFrom = next()
    else if (arg === '--force') args.force = true
    else if (arg === '--help') args.help = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return args
}

function normalizeRel(value) {
  return String(value).replace(/\\/g, '/')
}

function resolveInside(root, relPath) {
  if (typeof relPath !== 'string' || relPath.trim() === '' || path.isAbsolute(relPath)) {
    return { error: 'relative-path-required' }
  }
  const base = path.resolve(root)
  const target = path.resolve(base, relPath)
  const relative = path.relative(base, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return { error: 'outside-root', target }
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

async function dirExists(filePath) {
  try {
    return (await fs.stat(filePath)).isDirectory()
  } catch {
    return false
  }
}

async function sha256File(filePath) {
  return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex')
}

function assertIsoDate(value, label, blockers) {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || timestamp <= Date.parse('2020-01-01T00:00:00Z')) {
    blockers.push(`${label} must be a real ISO timestamp after 2020-01-01.`)
    return null
  }
  return new Date(timestamp)
}

function timestampSlug(date) {
  return date.toISOString().replace(/[:.]/g, '-')
}

function sourceRelForEvidencePath(relPath) {
  const normalized = normalizeRel(relPath)
  const prefix = `${EVIDENCE_ROOT}/`
  if (!normalized.startsWith(prefix)) return null
  return normalized.slice(prefix.length)
}

function requiredCaptureFiles(template) {
  const files = []
  for (const listName of ['supportingFiles', 'screenshots', 'logs', 'saveSnapshots']) {
    for (const destination of template[listName] ?? []) {
      const sourceRel = sourceRelForEvidencePath(destination)
      files.push({
        group: listName,
        captureRelPath: sourceRel,
        importDestination: destination
      })
    }
  }
  return files
}

function noteTemplate(relPath, args, template, expectedAsset) {
  const title = {
    'fresh-world-notes.md': 'Fresh World Creation',
    'first-30-minutes-notes.md': 'First 30 Minutes',
    'first-2-hours-notes.md': 'First 2 Hours',
    'survey-array-verification.md': 'Survey Array Verification',
    'no-crash-review.md': 'No Crash Review'
  }[relPath] ?? relPath
  return `# ${title}

${TEMPLATE_MARKER}

Pack: ${template.packId}
Artifact: ${expectedAsset?.name ?? template.run?.artifactAsset ?? 'unknown'}
Tester: ${args.tester}
World/profile: ${args.worldOrProfile}
Started at: ${args.startedAt}

Replace this template with real observations from the manual run before import.
Do not remove this marker until the note is based on captured play evidence.
`
}

function findEditionDownload(downloadEvidence, manifest, template) {
  const packId = manifest.packId
  const artifactName = template.run?.artifactAsset
  const edition = downloadEvidence?.data?.editions?.find((item) => item?.packId === packId)
  const asset = edition?.downloadedAssets?.find((item) => item?.name === artifactName)
    ?? edition?.downloadedAssets?.find((item) => String(item?.name ?? '').endsWith('.zip'))
  if (!edition || !asset) return { edition: edition ?? null, asset: null }
  return { edition, asset }
}

function resolveArtifactPath({ args, releaseIndexRoot, expectedAsset }) {
  if (args.artifact) return args.artifact
  if (!expectedAsset?.localPath) return ''
  return path.isAbsolute(expectedAsset.localPath)
    ? path.resolve(expectedAsset.localPath)
    : path.resolve(releaseIndexRoot, expectedAsset.localPath)
}

async function buildArtifactRecord(artifactPath, expectedAsset, blockers) {
  if (!artifactPath) {
    blockers.push('No pack artifact path was supplied and no downloaded zip was found in Release Index evidence.')
    return null
  }
  if (!(await fileExists(artifactPath))) {
    blockers.push(`artifact does not exist: ${artifactPath}`)
    return null
  }
  const stat = await fs.stat(artifactPath)
  const sha256 = await sha256File(artifactPath)
  const name = path.basename(artifactPath)
  if (expectedAsset) {
    if (name !== expectedAsset.name) blockers.push(`artifact file name ${name} does not match downloaded asset ${expectedAsset.name}.`)
    if (Number(stat.size) !== Number(expectedAsset.size)) blockers.push(`artifact size ${stat.size} does not match downloaded asset ${expectedAsset.size}.`)
    if (sha256 !== expectedAsset.sha256) blockers.push(`artifact SHA-256 ${sha256} does not match downloaded asset ${expectedAsset.sha256}.`)
  }
  return {
    path: artifactPath,
    name,
    size: stat.size,
    sha256,
    expectedDownloadedAsset: expectedAsset ? {
      name: expectedAsset.name,
      size: expectedAsset.size,
      sha256: expectedAsset.sha256,
      githubDigestSha256: expectedAsset.githubDigestSha256 ?? null,
      browserDownloadUrl: expectedAsset.browserDownloadUrl ?? null,
      apiUrl: expectedAsset.apiUrl ?? null,
      state: expectedAsset.state ?? null,
      localPath: expectedAsset.localPath ?? null
    } : null,
    matchesExpected: Boolean(expectedAsset)
      && name === expectedAsset.name
      && Number(stat.size) === Number(expectedAsset.size)
      && sha256 === expectedAsset.sha256
  }
}

function importCommand(args, artifactPath) {
  return [
    'node scripts\\import-manual-gameplay-capture.mjs',
    `--capture-root "${args.captureRoot}"`,
    `--artifact "${artifactPath}"`,
    `--tester "${args.tester}"`,
    `--world-or-profile "${args.worldOrProfile}"`,
    `--started-at "${args.startedAt}"`,
    '--force'
  ].join(' ')
}

function verifyCommands() {
  return [
    'node scripts\\verify-manual-gameplay-evidence.mjs --template-only',
    'node scripts\\verify-manual-gameplay-evidence.mjs --require-release-ready'
  ]
}

function buildManifest({ args, manifest, template, downloadEvidencePath, downloadEdition, artifact, requiredFiles }) {
  const importCmd = importCommand(args, artifact?.path ?? args.artifact)
  return {
    schemaVersion: 'echo.galactic_survey.manual-gameplay-capture-manifest.v1',
    status: 'READY_FOR_CAPTURE',
    generatedAt: new Date().toISOString(),
    packId: manifest.packId,
    displayName: manifest.displayName,
    runtimeTarget: manifest.runtimeTarget,
    loader: manifest.loader,
    releaseTag: downloadEdition?.releaseTag ?? template.run?.releaseTag ?? null,
    captureRoot: args.captureRoot,
    run: {
      tester: args.tester,
      worldOrProfile: args.worldOrProfile,
      startedAt: args.startedAt,
      installedFrom: args.installedFrom
    },
    releaseIndex: {
      downloadEvidence: normalizeRel(downloadEvidencePath),
      releaseUrl: downloadEdition?.release?.htmlUrl ?? null,
      releaseDraft: downloadEdition?.release?.draft ?? null,
      releasePrerelease: downloadEdition?.release?.prerelease ?? null
    },
    artifact,
    requiredFiles: requiredFiles.map((file) => ({
      ...file,
      capturePath: file.captureRelPath ? path.join(args.captureRoot, file.captureRelPath) : null
    })),
    commands: {
      import: importCmd,
      verify: verifyCommands()
    },
    notes: [
      'This manifest prepares a manual capture. It is not proof that gameplay happened.',
      'The importer must still reject this folder until real notes, screenshots, logs, and save snapshots replace the templates.',
      `Remove ${TEMPLATE_MARKER} from note files only after replacing them with real captured observations.`
    ]
  }
}

function buildReadme({ captureManifest }) {
  const requiredLines = captureManifest.requiredFiles.map((file) => `- \`${normalizeRel(file.captureRelPath)}\``).join('\n')
  const verifyLines = captureManifest.commands.verify.map((command) => `  ${command}`).join('\n')
  return `# Galactic Survey Manual Gameplay Capture

Status: \`${captureManifest.status}\`

This folder was prepared for a real Galactic Survey manual gameplay run. It is
not release evidence until every required file below is replaced with real
capture output and the import plus verifier commands pass.

## Artifact

- Asset: \`${captureManifest.artifact?.name ?? 'unknown'}\`
- SHA-256: \`${captureManifest.artifact?.sha256 ?? 'unknown'}\`
- Release: ${captureManifest.releaseIndex.releaseUrl ?? 'unknown'}

## Required Files

${requiredLines}

## Import

\`\`\`powershell
${captureManifest.commands.import}
\`\`\`

## Verify

\`\`\`powershell
${verifyLines}
\`\`\`

Do not import template-only notes, placeholder screenshots, empty logs, or fake
save zips. The importer and verifier are expected to stay blocked until the run
is real.
`
}

async function writePreparedCapture({ args, captureManifest, template }) {
  await fs.mkdir(args.captureRoot, { recursive: true })
  for (const file of captureManifest.requiredFiles) {
    if (!file.captureRelPath) continue
    const target = path.join(args.captureRoot, file.captureRelPath)
    await fs.mkdir(path.dirname(target), { recursive: true })
    if (file.group === 'supportingFiles' && path.extname(target).toLowerCase() === '.md') {
      await fs.writeFile(target, noteTemplate(file.captureRelPath, args, template, captureManifest.artifact?.expectedDownloadedAsset), 'utf8')
    }
  }
  await fs.writeFile(path.join(args.captureRoot, 'capture-manifest.json'), `${JSON.stringify(captureManifest, null, 2)}\n`, 'utf8')
  await fs.writeFile(path.join(args.captureRoot, 'README.md'), buildReadme({ captureManifest }), 'utf8')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write(usage())
    return
  }

  const root = path.resolve(args.root)
  const releaseIndexRoot = args.releaseIndexRoot || path.resolve(root, '..', 'ECHO-Release-Index')
  const blockers = []
  for (const option of REQUIRED_OPTIONS) {
    if (!String(args[option] ?? '').trim()) blockers.push(`--${option.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)} is required.`)
  }
  const startedAt = assertIsoDate(args.startedAt, '--started-at', blockers)
  const templatePath = resolveInside(root, args.template)
  if (templatePath.error) blockers.push(`Template path must stay inside the repo: ${args.template}`)

  const manifest = await readJson(path.join(root, 'release-manifest.template.json')).catch((error) => {
    blockers.push(`release-manifest.template.json could not be read: ${error.message}`)
    return null
  })
  const template = templatePath.error ? null : await readJson(templatePath.target).catch((error) => {
    blockers.push(`${args.template} could not be read: ${error.message}`)
    return null
  })

  const downloadEvidencePath = path.resolve(releaseIndexRoot, args.downloadEvidence)
  const downloadEvidence = await readJson(downloadEvidencePath).catch((error) => {
    blockers.push(`Release Index download evidence could not be read: ${downloadEvidencePath}: ${error.message}`)
    return null
  })
  if (downloadEvidence && downloadEvidence.status !== 'PASS') {
    blockers.push(`Release Index download evidence status must be PASS, got ${downloadEvidence.status}.`)
  }

  const { edition: downloadEdition, asset: expectedAsset } = manifest && template && downloadEvidence
    ? findEditionDownload(downloadEvidence, manifest, template)
    : { edition: null, asset: null }
  if (manifest && template && downloadEvidence && !downloadEdition) blockers.push(`Download evidence has no edition row for ${manifest.packId}.`)
  if (manifest && template && downloadEdition && !expectedAsset) blockers.push(`Download evidence has no downloaded zip asset for ${manifest.packId}.`)

  if (startedAt && manifest && !args.captureRoot) {
    args.captureRoot = path.resolve(root, 'tmp', 'galactic-survey-gameplay-capture', manifest.packId, timestampSlug(startedAt))
  }
  if (!args.captureRoot) blockers.push('--capture-root is required when --started-at is invalid.')
  if (args.captureRoot && await dirExists(args.captureRoot) && !args.force) {
    blockers.push(`capture root already exists; pass --force to prepare inside it: ${args.captureRoot}`)
  }

  const artifactPath = resolveArtifactPath({ args, releaseIndexRoot, expectedAsset })
  const artifact = await buildArtifactRecord(artifactPath, expectedAsset, blockers)
  const requiredFiles = template ? requiredCaptureFiles(template) : []
  for (const file of requiredFiles) {
    if (!file.captureRelPath) blockers.push(`${file.importDestination} is not under ${EVIDENCE_ROOT}.`)
  }

  const captureManifest = manifest && template && artifact ? buildManifest({
    args,
    manifest,
    template,
    downloadEvidencePath: path.relative(releaseIndexRoot, downloadEvidencePath),
    downloadEdition,
    artifact,
    requiredFiles
  }) : null

  if (captureManifest && blockers.length === 0) {
    await writePreparedCapture({ args, captureManifest, template })
  }

  const report = {
    schemaVersion: 'echo.galactic_survey.manual-gameplay-capture-prep.v1',
    status: blockers.length ? 'BLOCKED' : 'READY_FOR_CAPTURE',
    generatedAt: new Date().toISOString(),
    packId: manifest?.packId ?? null,
    captureRoot: args.captureRoot,
    artifact,
    manifestPath: captureManifest ? path.join(args.captureRoot, 'capture-manifest.json') : null,
    readmePath: captureManifest ? path.join(args.captureRoot, 'README.md') : null,
    requiredFileCount: requiredFiles.length,
    blockers
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (report.status !== 'READY_FOR_CAPTURE') process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exitCode = 1
})
