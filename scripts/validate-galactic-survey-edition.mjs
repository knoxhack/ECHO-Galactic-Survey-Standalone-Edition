#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.argv.includes('--root') ? process.argv[process.argv.indexOf('--root') + 1] : '.')
const moduleRoot = path.resolve(
  process.argv.includes('--module-root')
    ? process.argv[process.argv.indexOf('--module-root') + 1]
    : path.join(root, '..', 'ECHO-Modules', 'addons', 'echogalacticsurveyprotocol')
)
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'release-manifest.template.json'), 'utf8'))
const fail = (message) => { throw new Error(message) }

const edition = manifest.runtimeTarget === 'echo_native'
  ? 'native'
  : manifest.runtimeTarget === 'neoforge'
    ? 'neoforge'
    : 'standalone'

const expectedFamily = {
  echo_native: 'echo-addon',
  neoforge: 'neoforge',
  echo_runtime_standalone: 'standalone'
}[manifest.runtimeTarget]

const requiredModules = [
  'echocore',
  'echonetcore',
  'echoadaptercore',
  'echoruntimeguard',
  'echogalacticcore',
  'echoorbitalremnants',
  'echovehiclecore',
  'echoholomap',
  'echoterminal',
  'echoindex',
  'echolens',
  'echomissioncore',
  'echopowergrid',
  'echologisticsnetwork',
  'echoprogressioncore',
  'echosoundcore',
  'echogalacticsurveyprotocol'
]

const requiredDocs = [
  'README.md',
  'release-manifest.template.json',
  'scripts/validate-galactic-survey-edition.mjs',
  'scripts/init-manual-gameplay-evidence.mjs',
  'scripts/verify-manual-gameplay-evidence.mjs',
  'scripts/test-manual-gameplay-evidence-tools.mjs',
  'docs/install.md',
  'docs/update-flow.md',
  'docs/rollback.md',
  'docs/gameplay-evidence.md',
  'docs/module-requirements.md',
  'docs/runtime-evidence.md',
  'docs/troubleshooting.md',
  `evidence/${edition}-harness-driver-manifest.template.json`,
  'fixtures/galactic-survey/gameplay-qa/release-gates.contract.json',
  'fixtures/galactic-survey/gameplay-qa/manual-evidence.template.json',
  'fixtures/galactic-survey/gameplay-qa/manual-evidence.json',
  'fixtures/galactic-survey/gameplay-qa/evidence/CAPTURE_CHECKLIST.md',
  'fixtures/galactic-survey/gameplay-qa/evidence/templates/fresh-world-notes.template.md',
  'fixtures/galactic-survey/gameplay-qa/evidence/templates/first-30-minutes-notes.template.md',
  'fixtures/galactic-survey/gameplay-qa/evidence/templates/first-2-hours-notes.template.md',
  'fixtures/galactic-survey/gameplay-qa/evidence/templates/survey-array-verification.template.md',
  'fixtures/galactic-survey/gameplay-qa/evidence/templates/launcher-flow-review.template.md',
  'fixtures/galactic-survey/gameplay-qa/evidence/templates/no-crash-review.template.md'
]

if (!manifest.packId?.startsWith('galactic-survey-')) fail('packId must start with galactic-survey-.')
if (manifest.moduleArtifactFamily !== expectedFamily) {
  fail(`moduleArtifactFamily must be ${expectedFamily} for ${manifest.runtimeTarget}.`)
}
for (const moduleId of requiredModules) {
  if (manifest.moduleRequirements?.some((entry) => entry.id === moduleId) !== true) {
    fail(`release manifest must require ${moduleId}.`)
  }
}
if (!manifest.requiredRuntimeEvidenceContract?.includes('galacticsurvey/plan/production_phase_matrix.json')) {
  fail('requiredRuntimeEvidenceContract must point at the Galactic Survey production phase matrix.')
}
for (const doc of requiredDocs) {
  if (!fs.existsSync(path.join(root, doc))) fail(`Missing required file ${doc}.`)
}

const template = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/galactic-survey/gameplay-qa/manual-evidence.template.json'), 'utf8'))
const requiredClaims = [
  'realFirst30Playthrough',
  'realFirst2HourPlaythrough',
  'realSurveyArrayPlaythrough',
  'freshWorldCreated',
  'saveReloadVerified',
  'noCrashEvidence',
  'launcherInstallUpdateRepairRollback'
]
const requiredSessionIds = [
  'fresh_world_creation',
  'first_30_minutes',
  'first_2_hours',
  'survey_array_completion',
  'save_reload_verification',
  'launcher_flow_verification',
  'no_crash_review'
]
const requiredClaimByProof = new Map([
  ['probe:starter_probe', 'realFirst30Playthrough'],
  ['holomap_layer:scan_cones', 'realFirst30Playthrough'],
  ['discovery:barren_moon_kg_01a', 'realFirst30Playthrough'],
  ['route:near_sector_01_survey_hop', 'realFirst2HourPlaythrough'],
  ['salvage:derelict_relay_osprey', 'realFirst2HourPlaythrough'],
  ['item:long_range_probe', 'realFirst2HourPlaythrough'],
  ['mission:first_survey_circuit', 'realFirst2HourPlaythrough'],
  ['manual:real_first_30_playthrough', 'realFirst30Playthrough'],
  ['manual:real_first_2_hour_playthrough', 'realFirst2HourPlaythrough'],
  ['manual:real_survey_array_playthrough', 'realSurveyArrayPlaythrough'],
  ['manual:fresh_world_created', 'freshWorldCreated'],
  ['manual:save_reload_verified', 'saveReloadVerified'],
  ['manual:no_crash_evidence', 'noCrashEvidence'],
  ['launcher:install_update_repair_rollback', 'launcherInstallUpdateRepairRollback']
])
const canonicalReleaseGatesPath = path.join(
  moduleRoot,
  'src/main/resources/data/echogalacticsurveyprotocol/galacticsurvey/release/release_gates.json'
)
const releaseGateContract = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/galactic-survey/gameplay-qa/release-gates.contract.json'), 'utf8'))
if (template.schemaVersion !== 'echo.galactic_survey.gameplay-qa.manual.v1') fail('manual evidence template schema mismatch.')
if (template.packId !== manifest.packId) fail('manual evidence template packId must match manifest packId.')
if (template.run?.launcherChannel !== 'alpha') fail('manual evidence template launcherChannel must be alpha.')
if (releaseGateContract.schemaVersion !== 'echo.galactic_survey.release-gates.contract.v1') {
  fail('release gate contract schema mismatch.')
}
if (releaseGateContract.packId !== 'galactic-survey') fail('release gate contract packId must be galactic-survey.')
if (releaseGateContract.gates?.length !== 14) fail('release gate contract must define 14 gates.')
for (const claim of requiredClaims) {
  if (template.claims?.[claim] !== false) fail(`manual evidence template claim ${claim} must be false.`)
}
for (const gate of releaseGateContract.gates) {
  const requiredClaim = requiredClaimByProof.get(gate.proof)
  if (!requiredClaim) fail(`release gate contract ${gate.id} has unknown proof ${gate.proof}.`)
  if (gate.requiredClaim !== requiredClaim) {
    fail(`release gate contract ${gate.id} must map ${gate.proof} to ${requiredClaim}.`)
  }
}
const canonicalReleaseGateStatus = fs.existsSync(canonicalReleaseGatesPath) ? 'verified' : 'not_found'
if (canonicalReleaseGateStatus === 'verified') {
  const canonicalReleaseGates = JSON.parse(fs.readFileSync(canonicalReleaseGatesPath, 'utf8'))
  if (canonicalReleaseGates.schema !== 'echo.galactic_survey.release_gates.v1') {
    fail('canonical module release gate schema mismatch.')
  }
  if (canonicalReleaseGates.gates?.length !== releaseGateContract.gates.length) {
    fail('release gate contract must define the same number of gates as the canonical module.')
  }
  for (const canonicalGate of canonicalReleaseGates.gates) {
    const contractGate = releaseGateContract.gates.find((gate) => gate.id === canonicalGate.id)
    if (!contractGate) fail(`release gate contract missing canonical gate ${canonicalGate.id}.`)
    if (contractGate.proof !== canonicalGate.proof) {
      fail(`release gate contract ${canonicalGate.id} proof must match canonical module.`)
    }
    if (contractGate.required !== canonicalGate.required) {
      fail(`release gate contract ${canonicalGate.id} required flag must match canonical module.`)
    }
  }
}
for (const gate of releaseGateContract.gates) {
  const evidenceGate = template.releaseGates?.find((entry) => entry?.id === gate.id)
  if (!evidenceGate) fail(`manual evidence template missing release gate ${gate.id}.`)
  if (evidenceGate.proof !== gate.proof) fail(`manual evidence release gate ${gate.id} proof must match contract.`)
  if (evidenceGate.requiredClaim !== gate.requiredClaim) fail(`manual evidence release gate ${gate.id} requiredClaim must match contract.`)
  if (evidenceGate.satisfied !== false) fail(`manual evidence release gate ${gate.id} must start false.`)
  if (evidenceGate.evidenceSource !== 'template') fail(`manual evidence release gate ${gate.id} must start with template evidenceSource.`)
}
for (const sessionId of requiredSessionIds) {
  const session = template.sessions?.find((entry) => entry?.id === sessionId)
  if (!session) fail(`manual evidence template missing session ${sessionId}.`)
  if (!session.evidence || typeof session.evidence !== 'object') {
    fail(`manual evidence template session ${sessionId} must include evidence links.`)
  }
}

console.log(JSON.stringify({
  ok: true,
  packId: manifest.packId,
  runtimeTarget: manifest.runtimeTarget,
  loader: manifest.loader,
  artifactFamily: manifest.moduleArtifactFamily,
  moduleRequirements: manifest.moduleRequirements.length,
  evidenceCount: manifest.requiredPublicAlphaEvidence.length,
  releaseGateContract: {
    gates: releaseGateContract.gates.length,
    canonicalModule: canonicalReleaseGateStatus
  }
}, null, 2))
