const cron = require('node-cron');
const { loadConfigFromDb } = require('./config.js');
const { listActiveWorkspaces } = require('./db.js');
const { runScheduledDigests, runChangeDetection } = require('./runner.js');

const DAY_MAP = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

/**
 * Convert a config schedule string to a node-cron expression.
 * Accepts 'day HH:MM', 'weekdays HH:MM', 'weekends HH:MM', 'daily HH:MM',
 * or a raw 5-field cron expression (passed through unchanged).
 * @param {string} str
 * @returns {string}
 * @example scheduleStringToCron('sunday 18:00') // '0 18 * * 0'
 */
function scheduleStringToCron(str) {
  if (/^\d+\s+\d+\s+[\d*]+\s+[\d*]+\s+[\d*,\-\/]+$/.test(str.trim())) {
    return str.trim();
  }
  const match = str.trim().match(/^(sunday|monday|tuesday|wednesday|thursday|friday|saturday|weekdays|weekends|daily)\s+(\d{1,2}):(\d{2})$/i);
  if (!match) throw new Error(`Unrecognised schedule string: "${str}"`);
  const [, day, hours, minutes] = match;
  const h = parseInt(hours, 10);
  const m = parseInt(minutes, 10);
  const keyword = day.toLowerCase();
  if (keyword === 'weekdays') return `${m} ${h} * * 1-5`;
  if (keyword === 'weekends') return `${m} ${h} * * 0,6`;
  if (keyword === 'daily') return `${m} ${h} * * *`;
  return `${m} ${h} * * ${DAY_MAP[keyword]}`;
}

const JOBS = new Map();
let _cron = cron;

/**
 * Override node-cron for tests. Pass null to restore.
 * @param {object|null} mockCron
 */
function _setCronForTest(mockCron) {
  _cron = mockCron || cron;
}

/**
 * Number of workspaces currently registered. For tests only.
 * @returns {number}
 */
function _jobCount() {
  return JOBS.size;
}

/**
 * Register cron jobs for one workspace. Idempotent — stops old jobs first if already registered.
 * @param {import('better-sqlite3').Database} db
 * @param {string} workspaceId
 * @param {boolean} dryRun
 */
function scheduleWorkspace(db, workspaceId, dryRun) {
  if (JOBS.has(workspaceId)) unscheduleWorkspace(workspaceId);
  const config = loadConfigFromDb(db, workspaceId);
  const tasks = [];

  for (const channel of config.channels) {
    if (channel.digest_schedule) {
      const expr = scheduleStringToCron(channel.digest_schedule);
      console.log(`[scheduler] digest workspace=${workspaceId} channel=${channel.id} expr=${expr}`);
      tasks.push(_cron.schedule(expr, async () => {
        console.log(`[cron][${workspaceId}] digest firing for channel ${channel.id}`);
        try {
          await runScheduledDigests(db, workspaceId, dryRun);
        } catch (err) {
          console.error(`[cron][${workspaceId}] digest error:`, err.message);
        }
      }));
    }

    if (channel.daily_digest_schedule) {
      const expr = scheduleStringToCron(channel.daily_digest_schedule);
      console.log(`[scheduler] daily digest workspace=${workspaceId} channel=${channel.id} expr=${expr}`);
      tasks.push(_cron.schedule(expr, async () => {
        console.log(`[cron][${workspaceId}] daily digest firing for channel ${channel.id}`);
        try {
          await runScheduledDigests(db, workspaceId, dryRun);
        } catch (err) {
          console.error(`[cron][${workspaceId}] daily digest error:`, err.message);
        }
      }));
    }
  }

  const changeExpr = '0 6-18/2 * * *';
  console.log(`[scheduler] change-detection workspace=${workspaceId} expr=${changeExpr}`);
  tasks.push(_cron.schedule(changeExpr, async () => {
    console.log(`[cron][${workspaceId}] change detection firing`);
    try {
      await runChangeDetection(db, workspaceId, dryRun);
    } catch (err) {
      console.error(`[cron][${workspaceId}] change detection error:`, err.message);
    }
  }));

  JOBS.set(workspaceId, tasks);
  console.log(`[scheduler] registered ${tasks.length} job(s) for workspace ${workspaceId}`);
}

/**
 * Schedule jobs for all active workspaces. Called at server startup.
 * @param {import('better-sqlite3').Database} db
 * @param {boolean} dryRun
 */
async function scheduleAllWorkspaces(db, dryRun) {
  const workspaces = listActiveWorkspaces(db);
  for (const ws of workspaces) {
    scheduleWorkspace(db, ws.team_id, dryRun);
  }
  console.log(`[scheduler] scheduled jobs for ${workspaces.length} workspace(s)`);
}

/**
 * Stop and remove all cron jobs for a workspace. No-op if not registered.
 * @param {string} workspaceId
 */
function unscheduleWorkspace(workspaceId) {
  const tasks = JOBS.get(workspaceId);
  if (tasks) {
    tasks.forEach(job => job.stop());
    JOBS.delete(workspaceId);
    console.log(`[scheduler] unscheduled workspace ${workspaceId}`);
  }
}

/**
 * Stop all jobs for all workspaces and clear the registry.
 */
function stopAll() {
  for (const tasks of JOBS.values()) {
    tasks.forEach(job => job.stop());
  }
  JOBS.clear();
  console.log('[scheduler] all jobs stopped');
}

module.exports = {
  scheduleStringToCron,
  scheduleWorkspace,
  scheduleAllWorkspaces,
  unscheduleWorkspace,
  stopAll,
  _setCronForTest,
  _jobCount
};
