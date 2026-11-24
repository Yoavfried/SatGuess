import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { openRepository } from '../server/storage.mjs';

const makeRun = playerId => ({ id: 'run-one', playerId, kind: 'practice', status: 'in_progress', createdAt: 100, mode: 'normal', collection: 'landmarks', rounds: [] });
const makeAttempt = playerId => ({ id: 'attempt-one', runId: 'run-one', playerId, roundIndex: 0, sourcePlaceId: 'osm/node/1', placeRevisionId: 'revision-one', cohortKey: 'cohort-one', kind: 'practice', mode: 'normal', collection: 'landmarks', firstExposure: true, startedAt: 100, deadlineAt: null, finalizedAt: null, guessCoordinates: null, centerDistanceMeters: null, edgeDistanceMeters: null, score: null, outcome: null });

test('private daily selection seed survives restarts and is shared across repository connections', () => {
  const workspace = resolve('.'), directory = mkdtempSync(join(workspace, '.test-private-seed-')), filename = join(directory, 'state.sqlite');
  let first = openRepository({ filename }), second;
  try {
    const seed = first.getDailySeed();
    assert.match(seed, /^[a-f0-9]{64}$/);
    assert.equal(first.getDailySeed(), seed);
    second = openRepository({ filename });
    assert.equal(second.getDailySeed(), seed);
    first.close(); first = openRepository({ filename });
    assert.equal(first.getDailySeed(), seed);
    const session = first.resolveSession();
    assert.doesNotMatch(JSON.stringify(session.player), /dailySeed|session_hash/);
  } finally {
    first.close(); second?.close();
    if (!directory.startsWith(workspace + sep)) throw Error('Test cleanup target escaped workspace.');
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a saved run cannot diverge from normalized owner or source snapshot columns', () => {
  const repository = openRepository({ filename: ':memory:' });
  try {
    const owner = repository.resolveSession().player, other = repository.resolveSession().player;
    const run = { ...makeRun(owner.id), rounds: [{ index: 0, id: 'round-one', place: { id: 'osm/node/1', revisionId: 'revision-one', coordinates: [34.8, 32.1] }, cell: { id: 'normal:348:356' } }] };
    repository.saveRun(run);
    assert.throws(() => repository.saveRun({ ...run, playerId: other.id }), { code: 'RUN_SNAPSHOT_CONFLICT' });
    const moved = structuredClone(run); moved.rounds[0].place.coordinates[0] = 35;
    assert.throws(() => repository.saveRun(moved), { code: 'RUN_SNAPSHOT_CONFLICT' });
    assert.equal(repository.listRuns({ playerId: other.id }).length, 0);
    assert.deepEqual(repository.getRun(run.id), run);
    const completed = { ...run, status: 'completed', totalScore: 0 };
    repository.saveRun(completed);
    assert.throws(() => repository.saveRun({ ...completed, totalScore: 100 }), { code: 'RUN_FINALIZED' });
    assert.equal(repository.getRun(run.id).totalScore, 0);
  } finally { repository.close(); }
});

test('attempt cohort metadata and finalized score cannot be replaced by a replay', () => {
  const repository = openRepository({ filename: ':memory:' });
  try {
    const owner = repository.resolveSession().player, attempt = makeAttempt(owner.id);
    const run = { ...makeRun(owner.id), rounds: [{ attempt }] };
    repository.saveRun(run);
    assert.throws(() => repository.saveRun({ ...run, id: 'run-two' }), { code: 'ATTEMPT_SNAPSHOT_CONFLICT' });
    assert.equal(repository.getRun('run-two'), null);
    const conflicting = structuredClone(run); conflicting.rounds[0].attempt.cohortKey = 'different-cohort';
    assert.throws(() => repository.saveRun(conflicting), { code: 'ATTEMPT_SNAPSHOT_CONFLICT' });
    const finalized = structuredClone(run); Object.assign(finalized.rounds[0].attempt, { finalizedAt: 200, score: 50, outcome: 'submitted' });
    repository.saveRun(finalized);
    const replay = structuredClone(finalized); replay.rounds[0].attempt.score = 100;
    assert.throws(() => repository.saveRun(replay), { code: 'ATTEMPT_FINALIZED' });
    assert.equal(repository.listAttempts({ playerId: owner.id })[0].score, 50);
    assert.equal(repository.getRun(run.id).rounds[0].attempt.score, 50);
  } finally { repository.close(); }
});

test('declared async transactions are rejected before callbacks can escape their rollback boundary', async () => {
  const repository = openRepository({ filename: ':memory:' });
  try {
    const owner = repository.resolveSession().player;
    let called = false;
    assert.throws(() => repository.transaction(async () => { called = true; await Promise.resolve(); repository.markExposure(owner.id, 'place', 1); }), /synchronous/);
    await Promise.resolve();
    assert.equal(called, false);
    assert.equal(repository.markExposure(owner.id, 'place', 2), true);
    assert.throws(() => repository.transaction(() => repository.transaction(async () => {})), /synchronous/);
  } finally { repository.close(); }
});
