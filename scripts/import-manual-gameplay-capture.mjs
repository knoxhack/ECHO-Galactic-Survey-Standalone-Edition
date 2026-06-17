#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const DEFAULT_TEMPLATE = 'fixtures/galactic-survey/gameplay-qa/manual-evidence.template.json'
const DEFAULT_EVIDENCE = 'fixtures/galactic-survey/gameplay-qa/manual-evidence.json'
const EVIDENCE_ROOT = 'fixtures/galactic-survey/gameplay-qa/evidence'
const TEMPLATE_MARKER = 'ECHO_GALACTIC_SURVEY_TEMPLATE_ONLY'
const COMPUTER_USE_SESSION_FILE = 'computer-use-session.json'
const COMPUTER_USE_SESSION_SCHEMA = 'echo.release_index.family_gameplay_computer_use_session.v1'
const COMPUTER_USE_CHECK_STATUSES = new Set(['captured', 'blocked', 'not-attempted'])
const REQUIRED_OPTIONS = ['captureRoot', 'artifact', 'tester', 'worldOrProfile', 'startedAt']
const REQUIRED_CLAIMS = [
  'realFirst30Playthrough',
  'realFirst2HourPlaythrough',
  'realSurveyArrayPlaythrough',
  'freshWorldCreated',
  'saveReloadVerified',
  'noCrashEvidence'
]
const SESSION_SOURCE_BY_CLAIM = {
  realFirst30Playthrough: 'manual:first_30_minutes',
  realFirst2HourPlaythrough: 'manual:first_2_hours',
  realSurveyArrayPlaythrough: 'manual:survey_array_completion',
  freshWorldCreated: 'manual:fresh_world_creation',
  saveReloadVerified: 'manual:save_reload_verification',
  noCrashEvidence: 'manual:no_crash_review'
}

function usage() {
  return `Usage: node scripts/import-manual-gameplay-capture.mjs --capture-root <path> --artifact <path> --tester <name> --world-or-profile <name> --started-at <iso> [options]

Imports a real Galactic Survey manual gameplay capture into the committed
manual-evidence layout. The capture root must contain files relative to:

  fresh-world-notes.md
  first-30-minutes-notes.md
  first-2-hours-notes.md
  survey-array-verification.md
  no-crash-review.md
  screenshots/fresh-world-created.png
  screenshots/first-30-minutes.png
  screenshots/first-2-hours.png
  screenshots/survey-array-complete.png
  logs/client-playthrough.log
  saves/first-30-minutes-save.zip
  saves/first-2-hours-save.zip
  saves/survey-array-save.zip

Optional visible UI automation metadata:

  computer-use-session.json

Options:
  --root <path>              Edition repo root. Default: current directory.
  --template <path>          Evidence template path.
  --evidence <path>          Evidence output path.
  --capture-root <path>      Folder containing the real capture files.
  --artifact <path>          Published pack artifact used for the run. Must match capture-manifest.json.
  --tester <name>            Tester or device/run identifier.
  --world-or-profile <name>  World/profile name used for the run.
  --started-at <iso>         Real run start timestamp.
  --installed-from <text>    Install source. Default: ECHO Launcher.
  --dry-run                  Validate and print the import plan only.
  --force                    Replace an existing manual-evidence.json.
`
}

function parseArgs(argv) {
  const args = {
    root: process.cwd(),
    template: DEFAULT_TEMPLATE,
    evidence: DEFAULT_EVIDENCE,
    captureRoot: '',
    artifact: '',
    tester: '',
    worldOrProfile: '',
    startedAt: '',
    installedFrom: 'ECHO Launcher',
    dryRun: false,
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
    else if (arg === '--evidence') args.evidence = next()
    else if (arg === '--capture-root') args.captureRoot = path.resolve(next())
    else if (arg === '--artifact') args.artifact = path.resolve(next())
    else if (arg === '--tester') args.tester = next()
    else if (arg === '--world-or-profile') args.worldOrProfile = next()
    else if (arg === '--started-at') args.startedAt = next()
    else if (arg === '--installed-from') args.installedFrom = next()
    else if (arg === '--dry-run') args.dryRun = true
    else if (arg === '--force') args.force = true
    else if (arg === '--help') args.help = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return args
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

async function readJsonOrNull(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'))
  } catch {
    return null
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

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60_000).toISOString()
}

function evidenceSourceForGate(gate) {
  if (gate.proof === 'manual:real_first_30_playthrough') return 'manual:first_30_minutes'
  if (gate.proof === 'manual:real_first_2_hour_playthrough') return 'manual:first_2_hours'
  if (gate.proof === 'manual:real_survey_array_playthrough') return 'manual:survey_array_completion'
  return SESSION_SOURCE_BY_CLAIM[gate.requiredClaim] ?? 'manual:unknown'
}

function sourceRelForEvidencePath(relPath) {
  const normalized = relPath.replace(/\\/g, '/')
  const prefix = `${EVIDENCE_ROOT}/`
  if (!normalized.startsWith(prefix)) return null
  return normalized.slice(prefix.length)
}

function normalizeReference(value) {
  return String(value ?? '').trim().replace(/\\/g, '/')
}

function laneFromPackId(packId) {
  const value = String(packId ?? '')
  if (value.includes('-native-')) return 'native'
  if (value.includes('-neoforge-')) return 'neoforge'
  if (value.includes('-standalone-')) return 'standalone'
  return 'unknown'
}

function manifestPackId(manifest) {
  return manifest?.packId ?? manifest?.pack ?? manifest?.id ?? null
}

function acceptedComputerUseRefs(template, copyPlan) {
  const refs = new Set(REQUIRED_CLAIMS.map(normalizeReference))
  for (const group of ['supportingFiles', 'screenshots', 'logs', 'saveSnapshots']) {
    for (const destination of template?.[group] ?? []) refs.add(normalizeReference(destination))
  }
  for (const item of copyPlan) {
    refs.add(normalizeReference(item.destination))
    const sourceRel = sourceRelForEvidencePath(item.destination)
    if (sourceRel) refs.add(normalizeReference(sourceRel))
  }
  return refs
}

function verificationSummary(checks) {
  return {
    checkCount: checks.length,
    capturedCount: checks.filter((check) => check.status === 'captured').length,
    blockedCount: checks.filter((check) => check.status === 'blocked').length,
    notAttemptedCount: checks.filter((check) => check.status === 'not-attempted').length
  }
}

function validateComputerUseVerificationSummary(checks, summary, blockers) {
  const expected = verificationSummary(checks)
  if (!summary || typeof summary !== 'object') {
    blockers.push(`${COMPUTER_USE_SESSION_FILE} verificationSummary is missing.`)
    return
  }
  for (const [key, value] of Object.entries(expected)) {
    if (summary[key] !== value) blockers.push(`${COMPUTER_USE_SESSION_FILE} verificationSummary.${key} is ${summary[key] ?? 'missing'}, expected ${value}.`)
  }
}

function normalizeComputerUseChecks(checks, proofRefMap) {
  return checks.map((check) => {
    const rawRef = normalizeReference(check?.evidenceRef)
    return {
      id: String(check?.id ?? '').trim(),
      label: String(check?.label ?? '').trim(),
      status: String(check?.status ?? '').trim().toLowerCase(),
      evidenceRef: rawRef ? proofRefMap.get(rawRef) ?? rawRef : null,
      note: check?.note ? String(check.note).trim() : null
    }
  })
}

async function importComputerUseSession({ args, template, copyPlan, blockers }) {
  const source = path.join(args.captureRoot, COMPUTER_USE_SESSION_FILE)
  if (!(await fileExists(source))) return null
  let session
  try {
    session = await readJson(source)
  } catch (error) {
    blockers.push(`${COMPUTER_USE_SESSION_FILE} could not be parsed as JSON: ${error.message}`)
    return null
  }

  const hasSessionContent = Array.isArray(session.actions) && session.actions.length > 0
    || Array.isArray(session.verificationChecks) && session.verificationChecks.length > 0
    || Boolean(String(session.appId ?? '').trim())
    || Boolean(String(session.windowTitle ?? '').trim())
  if (!hasSessionContent) return null

  if (session.schemaVersion !== COMPUTER_USE_SESSION_SCHEMA) {
    blockers.push(`${COMPUTER_USE_SESSION_FILE} schemaVersion is ${session.schemaVersion ?? 'missing'}, expected ${COMPUTER_USE_SESSION_SCHEMA}.`)
    return null
  }
  if (!Array.isArray(session.actions) || session.actions.length === 0) {
    blockers.push(`${COMPUTER_USE_SESSION_FILE} must list visible Computer Use actions.`)
  }

  const proofRefMap = new Map()
  for (const item of copyPlan) {
    const sourceRel = sourceRelForEvidencePath(item.destination)
    if (sourceRel) proofRefMap.set(normalizeReference(sourceRel), normalizeReference(item.destination))
  }
  const checks = Array.isArray(session.verificationChecks)
    ? normalizeComputerUseChecks(session.verificationChecks, proofRefMap)
    : []
  if (!Array.isArray(session.verificationChecks)) {
    blockers.push(`${COMPUTER_USE_SESSION_FILE} verificationChecks must be an array when visible Computer Use metadata is supplied.`)
  }

  const acceptedRefs = acceptedComputerUseRefs(template, copyPlan)
  for (const [index, check] of checks.entries()) {
    const prefix = `${COMPUTER_USE_SESSION_FILE} verificationChecks[${index}]`
    if (!check.id) blockers.push(`${prefix}.id is required.`)
    if (!check.label) blockers.push(`${prefix}.label is required.`)
    if (!COMPUTER_USE_CHECK_STATUSES.has(check.status)) blockers.push(`${prefix}.status must be captured, blocked, or not-attempted.`)
    if (check.status === 'captured') {
      const evidenceRef = normalizeReference(check.evidenceRef)
      if (!evidenceRef) blockers.push(`${prefix}.evidenceRef is required when status is captured.`)
      else if (!acceptedRefs.has(evidenceRef)) blockers.push(`${prefix}.evidenceRef ${evidenceRef} must reference a required claim or imported local proof path.`)
    }
  }
  validateComputerUseVerificationSummary(checks, session.verificationSummary, blockers)

  const outputRelative = `${EVIDENCE_ROOT}/${COMPUTER_USE_SESSION_FILE}`
  return {
    source,
    destination: outputRelative,
    session: {
      ...session,
      schemaVersion: COMPUTER_USE_SESSION_SCHEMA,
      family: 'Galactic Survey',
      familyKey: 'galactic-survey',
      lane: laneFromPackId(template?.packId),
      packId: template?.packId ?? null,
      verificationChecks: checks,
      verificationSummary: verificationSummary(checks),
      importedAt: new Date().toISOString()
    }
  }
}

async function loadCaptureManifest(captureRoot, template, artifact, blockers) {
  const manifestPath = path.join(captureRoot, 'capture-manifest.json')
  const manifest = await readJsonOrNull(manifestPath)
  if (!manifest) {
    blockers.push('capture-manifest.json is missing; run prepare-manual-gameplay-capture.mjs before the manual run.')
    return null
  }
  if (manifest.schemaVersion !== 'echo.galactic_survey.manual-gameplay-capture-manifest.v1') {
    blockers.push('capture-manifest.json schemaVersion mismatch.')
  }
  if (manifestPackId(manifest) !== template?.packId) {
    blockers.push(`capture-manifest.json packId ${manifestPackId(manifest)} does not match template ${template?.packId}.`)
  }
  const expected = manifest.artifact?.expectedDownloadedAsset
  if (!expected) {
    blockers.push('capture-manifest.json must include artifact.expectedDownloadedAsset from Release Index download evidence.')
  } else if (artifact) {
    if (artifact.name !== expected.name) blockers.push(`artifact file name ${artifact.name} does not match prepared asset ${expected.name}.`)
    if (Number(artifact.size) !== Number(expected.size)) blockers.push(`artifact size ${artifact.size} does not match prepared asset ${expected.size}.`)
    if (artifact.sha256 !== expected.sha256) blockers.push(`artifact SHA-256 ${artifact.sha256} does not match prepared asset ${expected.sha256}.`)
  }
  return { path: manifestPath, manifest }
}

async function validateCaptureFile({ source, destination, blockers }) {
  if (!(await fileExists(source))) {
    blockers.push(`capture file missing for ${destination}: ${source}`)
    return null
  }
  const stat = await fs.stat(source)
  if (stat.size < 1) blockers.push(`capture file is empty for ${destination}: ${source}`)
  const ext = path.extname(destination).toLowerCase()
  const bytes = await fs.readFile(source)
  if (ext === '.md' || ext === '.log' || ext === '.txt') {
    const text = bytes.toString('utf8')
    if (text.includes(TEMPLATE_MARKER)) blockers.push(`${source} still contains template marker ${TEMPLATE_MARKER}.`)
    if (/\bTBD\b|placeholder|template only/i.test(text)) blockers.push(`${source} still looks like placeholder text.`)
  }
  if (ext === '.png') {
    const pngSignature = '89504e470d0a1a0a'
    if (bytes.subarray(0, 8).toString('hex') !== pngSignature) blockers.push(`${source} is not a PNG file.`)
  }
  if (ext === '.zip') {
    const signature = bytes.subarray(0, 4).toString('hex')
    if (signature !== '504b0304' && signature !== '504b0506' && signature !== '504b0708') {
      blockers.push(`${source} is not a ZIP file.`)
    }
  }
  return {
    source,
    destination,
    size: stat.size,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex')
  }
}

function buildSessions(template, start) {
  return (template.sessions ?? []).map((session) => {
    const duration = Number(session.durationMinutes ?? 1)
    const offset = {
      fresh_world_creation: 0,
      first_30_minutes: 0,
      first_2_hours: 0,
      survey_array_completion: 120,
      save_reload_verification: 121,
      no_crash_review: 123
    }[session.id] ?? 0
    return {
      ...session,
      startedAt: addMinutes(start, offset),
      endedAt: addMinutes(start, offset + duration),
      durationMinutes: duration
    }
  })
}

function buildEvidence({ template, artifact, artifactSha256, artifactSize, args, startedAt, captureManifest, computerUseSession }) {
  const claims = Object.fromEntries(REQUIRED_CLAIMS.map((claim) => [claim, true]))
  const expected = captureManifest?.manifest?.artifact?.expectedDownloadedAsset ?? null
  return {
    ...template,
    generatedAt: new Date().toISOString(),
    claims,
    releaseGates: (template.releaseGates ?? []).map((gate) => ({
      ...gate,
      satisfied: true,
      evidenceSource: evidenceSourceForGate(gate)
    })),
    notes: [
      'Imported from a real manual gameplay capture bundle.',
      'Do not edit claims or release gates by hand; rerun import-manual-gameplay-capture.mjs after replacing capture files.'
    ],
    run: {
      ...(template.run ?? {}),
      tester: args.tester,
      artifactAsset: expected?.name ?? template.run?.artifactAsset,
      artifactSha256,
      artifactSize,
      expectedArtifactSha256: expected?.sha256 ?? null,
      expectedArtifactSize: expected?.size ?? null,
      artifactMatchesExpected: Boolean(expected)
        && artifact.name === expected.name
        && artifactSha256 === expected.sha256
        && Number(artifactSize) === Number(expected.size),
      releaseTag: captureManifest?.manifest?.releaseTag ?? template.run?.releaseTag,
      worldOrProfile: args.worldOrProfile,
      installedFrom: args.installedFrom,
      startedAt: startedAt.toISOString()
    },
    sessions: buildSessions(template, startedAt),
    importedCapture: {
      captureRoot: args.captureRoot,
      artifact: artifact.path,
      artifactSha256,
      artifactSize,
      captureManifest: captureManifest?.path ?? null,
      expectedDownloadedAsset: expected,
      computerUseSession: computerUseSession?.destination ?? null,
      computerUseVerificationSummary: computerUseSession?.session?.verificationSummary ?? null,
      importedAt: new Date().toISOString()
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(usage())
    return
  }

  const root = path.resolve(args.root)
  const blockers = []
  for (const option of REQUIRED_OPTIONS) {
    if (!String(args[option] ?? '').trim()) blockers.push(`--${option.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)} is required.`)
  }
  const startedAt = assertIsoDate(args.startedAt, '--started-at', blockers)
  const templatePath = resolveInside(root, args.template)
  const evidencePath = resolveInside(root, args.evidence)
  if (templatePath.error) blockers.push(`Template path must stay inside the repo: ${args.template}`)
  if (evidencePath.error) blockers.push(`Evidence path must stay inside the repo: ${args.evidence}`)
  if (!(await fileExists(args.artifact))) blockers.push(`artifact does not exist: ${args.artifact}`)

  const template = templatePath.error ? null : await readJson(templatePath.target)
  const artifactStat = await fs.stat(args.artifact).catch(() => null)
  const artifact = artifactStat ? {
    path: args.artifact,
    name: path.basename(args.artifact),
    size: artifactStat.size,
    sha256: await sha256File(args.artifact)
  } : null
  const captureManifest = await loadCaptureManifest(args.captureRoot, template, artifact, blockers)

  const evidenceExists = evidencePath.error ? false : await fileExists(evidencePath.target)
  if (evidenceExists && !args.force) blockers.push(`${args.evidence} already exists; pass --force to replace it with imported capture evidence.`)

  const copyPlan = []
  if (template) {
    for (const listName of ['supportingFiles', 'screenshots', 'logs', 'saveSnapshots']) {
      for (const destination of template[listName] ?? []) {
        const sourceRel = sourceRelForEvidencePath(destination)
        if (!sourceRel) {
          blockers.push(`${listName} destination is not under ${EVIDENCE_ROOT}: ${destination}`)
          continue
        }
        const source = path.join(args.captureRoot, sourceRel)
        const capture = await validateCaptureFile({ source, destination, blockers })
        if (capture) copyPlan.push({ listName, ...capture })
      }
    }
  }

  const computerUseSession = template
    ? await importComputerUseSession({ args, template, copyPlan, blockers })
    : null

  const report = {
    schemaVersion: 'echo.galactic_survey.manual-gameplay-capture-import.v1',
    status: blockers.length ? 'BLOCKED' : 'PASS',
    mode: args.dryRun ? 'dry-run' : 'write',
    packId: template?.packId,
    evidencePath: args.evidence,
    captureRoot: args.captureRoot,
    artifact,
    captureManifest: captureManifest ? {
      path: captureManifest.path,
      packId: captureManifest.manifest?.packId,
      artifactMatchesExpected: captureManifest.manifest?.artifact?.matchesExpected === true
    } : null,
    computerUseSession: computerUseSession ? {
      source: computerUseSession.source,
      destination: computerUseSession.destination,
      verificationSummary: computerUseSession.session.verificationSummary
    } : null,
    copyPlan,
    blockers
  }

  if (!args.dryRun && report.status === 'PASS') {
    for (const item of copyPlan) {
      const target = resolveInside(root, item.destination).target
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.copyFile(item.source, target)
    }
    if (computerUseSession) {
      const target = resolveInside(root, computerUseSession.destination).target
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, `${JSON.stringify(computerUseSession.session, null, 2)}\n`, 'utf8')
    }
    await fs.mkdir(path.dirname(evidencePath.target), { recursive: true })
    await fs.writeFile(
      evidencePath.target,
      `${JSON.stringify(buildEvidence({ template, artifact, artifactSha256: artifact.sha256, artifactSize: artifact.size, args, startedAt, captureManifest, computerUseSession }), null, 2)}\n`,
      'utf8'
    )
  }

  console.log(JSON.stringify(report, null, 2))
  if (report.status !== 'PASS') process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exitCode = 1
})
