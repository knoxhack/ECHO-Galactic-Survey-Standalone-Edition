#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const DEFAULT_EVIDENCE = 'fixtures/galactic-survey/gameplay-qa/manual-evidence.json'
const DEFAULT_TEMPLATE = 'fixtures/galactic-survey/gameplay-qa/manual-evidence.template.json'
const DEFAULT_RELEASE_GATES = 'fixtures/galactic-survey/gameplay-qa/release-gates.contract.json'
const TEMPLATE_MARKER = 'ECHO_GALACTIC_SURVEY_TEMPLATE_ONLY'
const COMPUTER_USE_SESSION_SCHEMA = 'echo.release_index.family_gameplay_computer_use_session.v1'
const COMPUTER_USE_CHECK_STATUSES = new Set(['captured', 'blocked', 'not-attempted'])
const REQUIRED_CLAIMS = [
  'realFirst30Playthrough',
  'realFirst2HourPlaythrough',
  'realSurveyArrayPlaythrough',
  'freshWorldCreated',
  'saveReloadVerified',
  'noCrashEvidence'
]
const REQUIRED_SESSIONS = [
  'fresh_world_creation',
  'first_30_minutes',
  'first_2_hours',
  'survey_array_completion',
  'save_reload_verification',
  'no_crash_review'
]

function isRealValue(value) {
  if (value === null || value === undefined) return false
  if (typeof value === 'number') return Number.isFinite(value) && value > 0
  if (typeof value === 'boolean') return value === true
  if (typeof value !== 'string') return true
  const normalized = value.trim()
  return normalized !== '' && normalized !== 'TBD' && normalized !== 'template' && !normalized.startsWith('1970-01-01')
}

function parseArgs(argv) {
  const args = {
    root: process.cwd(),
    evidence: DEFAULT_EVIDENCE,
    template: DEFAULT_TEMPLATE,
    releaseGates: DEFAULT_RELEASE_GATES,
    templateOnly: false,
    requireReleaseReady: false
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = () => {
      const value = argv[++index]
      if (!value) throw new Error(`${arg} requires a value`)
      return value
    }
    if (arg === '--root') args.root = path.resolve(next())
    else if (arg === '--evidence') args.evidence = next()
    else if (arg === '--template') args.template = next()
    else if (arg === '--release-gates') args.releaseGates = next()
    else if (arg === '--template-only') args.templateOnly = true
    else if (arg === '--require-release-ready') args.requireReleaseReady = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return args
}

function resolveInside(root, relPath) {
  if (typeof relPath !== 'string' || relPath.trim() === '' || path.isAbsolute(relPath)) return { error: 'relative-path-required' }
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

function acceptedComputerUseRefs(evidence) {
  const refs = new Set(REQUIRED_CLAIMS.map(normalizeReference))
  for (const group of ['supportingFiles', 'screenshots', 'logs', 'saveSnapshots']) {
    for (const relativePath of Array.isArray(evidence?.[group]) ? evidence[group] : []) {
      refs.add(normalizeReference(relativePath))
    }
  }
  for (const gate of Array.isArray(evidence?.releaseGates) ? evidence.releaseGates : []) {
    if (gate?.requiredClaim) refs.add(normalizeReference(gate.requiredClaim))
    if (gate?.evidenceSource) refs.add(normalizeReference(gate.evidenceSource))
  }
  return refs
}

function validateComputerUseVerificationSummary(checks, summary, blockers) {
  if (!summary || typeof summary !== 'object') {
    blockers.push('manualEvidence.importedCapture.computerUseSession verificationSummary is missing.')
    return
  }
  const statuses = checks.map((check) => String(check?.status ?? '').trim().toLowerCase())
  const expected = {
    checkCount: checks.length,
    capturedCount: statuses.filter((status) => status === 'captured').length,
    blockedCount: statuses.filter((status) => status === 'blocked').length,
    notAttemptedCount: statuses.filter((status) => status === 'not-attempted').length
  }
  for (const [key, value] of Object.entries(expected)) {
    if (summary[key] !== value) blockers.push(`manualEvidence.importedCapture.computerUseSession verificationSummary.${key} is ${summary[key] ?? 'missing'}, expected ${value}.`)
  }
}

async function validateComputerUseSession({ root, manifest, evidence, blockers }) {
  const reference = evidence.importedCapture?.computerUseSession
  if (!reference) return null
  const resolved = resolveInside(root, reference)
  if (resolved.error || !(await fileExists(resolved.target))) {
    blockers.push(`manualEvidence.importedCapture.computerUseSession missing file ${reference}.`)
    return null
  }
  const session = await readJson(resolved.target)
  if (session.schemaVersion !== COMPUTER_USE_SESSION_SCHEMA) {
    blockers.push(`manualEvidence.importedCapture.computerUseSession schemaVersion is ${session.schemaVersion ?? 'missing'}, expected ${COMPUTER_USE_SESSION_SCHEMA}.`)
  }
  if (session.familyKey !== 'galactic-survey') blockers.push(`manualEvidence.importedCapture.computerUseSession familyKey is ${session.familyKey ?? 'missing'}, expected galactic-survey.`)
  const packId = manifestPackId(manifest)
  if (session.lane !== laneFromPackId(packId)) blockers.push(`manualEvidence.importedCapture.computerUseSession lane is ${session.lane ?? 'missing'}, expected ${laneFromPackId(packId)}.`)
  if (session.packId !== packId) blockers.push(`manualEvidence.importedCapture.computerUseSession packId is ${session.packId ?? 'missing'}, expected ${packId}.`)
  if (!Array.isArray(session.actions) || session.actions.length === 0) {
    blockers.push('manualEvidence.importedCapture.computerUseSession must list visible Computer Use actions.')
  }
  if (!Array.isArray(session.verificationChecks)) {
    blockers.push('manualEvidence.importedCapture.computerUseSession verificationChecks must be an array.')
  }
  const checks = Array.isArray(session.verificationChecks) ? session.verificationChecks : []
  const acceptedRefs = acceptedComputerUseRefs(evidence)
  for (const [index, check] of checks.entries()) {
    const prefix = `manualEvidence.importedCapture.computerUseSession verificationChecks[${index}]`
    if (!String(check?.id ?? '').trim()) blockers.push(`${prefix}.id is required.`)
    if (!String(check?.label ?? '').trim()) blockers.push(`${prefix}.label is required.`)
    const status = String(check?.status ?? '').trim().toLowerCase()
    if (!COMPUTER_USE_CHECK_STATUSES.has(status)) blockers.push(`${prefix}.status must be captured, blocked, or not-attempted.`)
    if (status === 'captured') {
      const evidenceRef = normalizeReference(check.evidenceRef)
      if (!evidenceRef) blockers.push(`${prefix}.evidenceRef is required when status is captured.`)
      else if (!acceptedRefs.has(evidenceRef)) blockers.push(`${prefix}.evidenceRef ${evidenceRef} must reference a required claim or imported local proof path.`)
    }
  }
  validateComputerUseVerificationSummary(checks, session.verificationSummary, blockers)
  return session
}

function validateReleaseGateContract({ contract, blockers }) {
  if (contract.schemaVersion !== 'echo.galactic_survey.release-gates.contract.v1') {
    blockers.push('release gate contract schemaVersion mismatch.')
  }
  if (contract.packId !== 'galactic-survey') {
    blockers.push('release gate contract packId must be galactic-survey.')
  }
  if (!Array.isArray(contract.gates) || contract.gates.length !== 13) {
    blockers.push('release gate contract must contain 13 gates.')
    return []
  }
  const seen = new Set()
  return contract.gates.map((gate) => {
    if (!gate?.id || seen.has(gate.id)) blockers.push(`release gate contract has duplicate or missing id ${gate?.id}.`)
    seen.add(gate?.id)
    if (gate.required !== true) blockers.push(`release gate contract ${gate.id} must be required.`)
    if (!gate.proof) blockers.push(`release gate contract ${gate.id} missing proof.`)
    if (!REQUIRED_CLAIMS.includes(gate.requiredClaim)) blockers.push(`release gate contract ${gate.id} has unknown requiredClaim ${gate.requiredClaim}.`)
    return { id: gate.id, proof: gate.proof, requiredClaim: gate.requiredClaim }
  })
}

function validateShape({ manifest, evidence, label, blockers, requiredReleaseGates }) {
  if (evidence.schemaVersion !== 'echo.galactic_survey.gameplay-qa.manual.v1') blockers.push(`${label}.schemaVersion mismatch.`)
  if (evidence.packId !== manifestPackId(manifest)) blockers.push(`${label}.packId must match manifest ${manifestPackId(manifest)}.`)
  for (const claim of REQUIRED_CLAIMS) {
    if (!(claim in (evidence.claims ?? {}))) blockers.push(`${label}.claims missing ${claim}.`)
  }
  for (const sessionId of REQUIRED_SESSIONS) {
    const session = evidence.sessions?.find((entry) => entry?.id === sessionId)
    if (!session) blockers.push(`${label}.sessions missing ${sessionId}.`)
    else if (!session.evidence || typeof session.evidence !== 'object') blockers.push(`${label}.sessions.${sessionId}.evidence missing.`)
  }
  for (const { id, proof, requiredClaim } of requiredReleaseGates) {
    const gate = evidence.releaseGates?.find((entry) => entry?.id === id)
    if (!gate) blockers.push(`${label}.releaseGates missing ${id}.`)
    else {
      if (gate.proof !== proof) blockers.push(`${label}.releaseGates.${id}.proof must be ${proof}.`)
      if (gate.requiredClaim !== requiredClaim) blockers.push(`${label}.releaseGates.${id}.requiredClaim must be ${requiredClaim}.`)
      if (typeof gate.satisfied !== 'boolean') blockers.push(`${label}.releaseGates.${id}.satisfied must be boolean.`)
    }
  }
}

async function validateRealEvidence({ root, manifest, evidencePath, blockers, requiredReleaseGates }) {
  const resolved = resolveInside(root, evidencePath)
  if (resolved.error || !(await fileExists(resolved.target))) {
    blockers.push(`manual evidence is missing: ${evidencePath}`)
    return null
  }
  const evidence = await readJson(resolved.target)
  validateShape({ manifest, evidence, label: 'manualEvidence', blockers, requiredReleaseGates })
  for (const claim of REQUIRED_CLAIMS) {
    if (evidence.claims?.[claim] !== true) blockers.push(`manualEvidence claim ${claim} must be true.`)
  }
  for (const { id, requiredClaim } of requiredReleaseGates) {
    const gate = evidence.releaseGates?.find((entry) => entry?.id === id)
    if (gate?.satisfied !== true) blockers.push(`manualEvidence release gate ${id} must be satisfied.`)
    if (evidence.claims?.[requiredClaim] !== true) blockers.push(`manualEvidence release gate ${id} requires claim ${requiredClaim}.`)
    if (!gate?.evidenceSource || gate.evidenceSource === 'template' || gate.evidenceSource === 'TBD') {
      blockers.push(`manualEvidence release gate ${id} must name real evidenceSource.`)
    }
  }
  for (const [field, value] of Object.entries(evidence.run ?? {})) {
    if (value === 'TBD' || value === 0 || String(value).startsWith('1970-01-01')) {
      blockers.push(`manualEvidence.run.${field} must contain real capture data.`)
    }
  }
  for (const field of ['expectedArtifactSha256', 'expectedArtifactSize', 'artifactMatchesExpected']) {
    if (!isRealValue(evidence.run?.[field])) blockers.push(`manualEvidence.run.${field} must prove the artifact matches Release Index download evidence.`)
  }
  if (evidence.run?.artifactMatchesExpected !== true) blockers.push('manualEvidence.run.artifactMatchesExpected must be true.')
  if (evidence.run?.expectedArtifactSha256 && evidence.run?.artifactSha256 && evidence.run.expectedArtifactSha256 !== evidence.run.artifactSha256) {
    blockers.push('manualEvidence.run.expectedArtifactSha256 must match artifactSha256.')
  }
  if (evidence.run?.expectedArtifactSize && evidence.run?.artifactSize && Number(evidence.run.expectedArtifactSize) !== Number(evidence.run.artifactSize)) {
    blockers.push('manualEvidence.run.expectedArtifactSize must match artifactSize.')
  }
  if (!evidence.importedCapture?.captureManifest) blockers.push('manualEvidence.importedCapture.captureManifest is required.')
  if (!evidence.importedCapture?.expectedDownloadedAsset) blockers.push('manualEvidence.importedCapture.expectedDownloadedAsset is required.')
  const computerUseSession = await validateComputerUseSession({ root, manifest, evidence, blockers })
  for (const listName of ['supportingFiles', 'screenshots', 'logs', 'saveSnapshots']) {
    for (const relPath of evidence[listName] ?? []) {
      const file = resolveInside(root, relPath)
      if (file.error || !(await fileExists(file.target))) {
        blockers.push(`manualEvidence.${listName} missing file ${relPath}.`)
        continue
      }
      const stat = await fs.stat(file.target)
      if (stat.size < 1) blockers.push(`manualEvidence.${listName} file is empty: ${relPath}.`)
      if (relPath.endsWith('.md')) {
        const text = await fs.readFile(file.target, 'utf8')
        if (text.includes(TEMPLATE_MARKER)) blockers.push(`${relPath} still contains template marker ${TEMPLATE_MARKER}.`)
      }
    }
  }
  return {
    ...evidence,
    computerUseSession
  }
}

const args = parseArgs(process.argv.slice(2))
const root = path.resolve(args.root)
const blockers = []
const manifest = await readJson(path.join(root, 'release-manifest.template.json'))
const template = await readJson(path.join(root, args.template))
const releaseGateContract = await readJson(path.join(root, args.releaseGates))
const requiredReleaseGates = validateReleaseGateContract({ contract: releaseGateContract, blockers })
validateShape({ manifest, evidence: template, label: 'template', blockers, requiredReleaseGates })
for (const claim of REQUIRED_CLAIMS) {
  if (template.claims?.[claim] !== false) blockers.push(`template claim ${claim} must remain false.`)
}
for (const { id } of requiredReleaseGates) {
  const gate = template.releaseGates?.find((entry) => entry?.id === id)
  if (gate?.satisfied !== false) blockers.push(`template release gate ${id} must remain false.`)
  if (gate?.evidenceSource !== 'template') blockers.push(`template release gate ${id} must use evidenceSource template.`)
}

const manualEvidence = args.templateOnly ? null : await validateRealEvidence({
  root,
  manifest,
  evidencePath: args.evidence,
  blockers,
  requiredReleaseGates
})
const report = {
  schemaVersion: 'echo.galactic_survey.edition-gameplay-evidence.v1',
  status: blockers.length ? 'BLOCKED' : 'PASS',
  mode: args.templateOnly ? 'template-only' : 'manual-evidence',
  generatedAt: new Date().toISOString(),
  packId: manifestPackId(manifest),
  runtimeTarget: manifest.runtimeTarget,
  evidencePath: args.evidence,
  releaseGateContractPath: args.releaseGates,
  requiredClaims: REQUIRED_CLAIMS,
  requiredReleaseGates,
  manualEvidence: manualEvidence ? {
    found: true,
    claims: manualEvidence.claims,
    artifactMatchesExpected: manualEvidence.run?.artifactMatchesExpected === true,
    releaseGates: manualEvidence.releaseGates?.map((gate) => ({ id: gate.id, satisfied: gate.satisfied, evidenceSource: gate.evidenceSource })),
    sessions: manualEvidence.sessions?.map((session) => session.id),
    computerUseSession: manualEvidence.computerUseSession ? {
      path: manualEvidence.importedCapture?.computerUseSession ?? null,
      verificationSummary: manualEvidence.computerUseSession.verificationSummary ?? null
    } : null
  } : null,
  blockers
}

console.log(JSON.stringify(report, null, 2))
if ((args.requireReleaseReady || args.templateOnly) && report.status !== 'PASS') process.exitCode = 1
