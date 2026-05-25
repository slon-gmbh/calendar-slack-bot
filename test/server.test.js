const { test } = require('node:test');
const assert = require('node:assert');
const { scheduleStringToCron } = require('../src/scheduler-registry.js');

test('scheduleStringToCron converts sunday HH:MM to cron', () => {
  assert.strictEqual(scheduleStringToCron('sunday 18:00'), '0 18 * * 0');
});

test('scheduleStringToCron converts monday HH:MM to cron', () => {
  assert.strictEqual(scheduleStringToCron('monday 08:30'), '30 8 * * 1');
});

test('scheduleStringToCron converts tuesday HH:MM to cron', () => {
  assert.strictEqual(scheduleStringToCron('tuesday 09:00'), '0 9 * * 2');
});

test('scheduleStringToCron converts wednesday HH:MM to cron', () => {
  assert.strictEqual(scheduleStringToCron('wednesday 12:00'), '0 12 * * 3');
});

test('scheduleStringToCron converts thursday HH:MM to cron', () => {
  assert.strictEqual(scheduleStringToCron('thursday 17:00'), '0 17 * * 4');
});

test('scheduleStringToCron converts friday HH:MM to cron', () => {
  assert.strictEqual(scheduleStringToCron('friday 07:00'), '0 7 * * 5');
});

test('scheduleStringToCron converts saturday HH:MM to cron', () => {
  assert.strictEqual(scheduleStringToCron('saturday 10:00'), '0 10 * * 6');
});

test('scheduleStringToCron converts weekdays HH:MM to cron', () => {
  assert.strictEqual(scheduleStringToCron('weekdays 08:00'), '0 8 * * 1-5');
});

test('scheduleStringToCron converts weekends HH:MM to cron', () => {
  assert.strictEqual(scheduleStringToCron('weekends 10:00'), '0 10 * * 0,6');
});

test('scheduleStringToCron converts daily HH:MM to cron', () => {
  assert.strictEqual(scheduleStringToCron('daily 07:00'), '0 7 * * *');
});

test('scheduleStringToCron passes through valid cron expression unchanged', () => {
  assert.strictEqual(scheduleStringToCron('0 18 * * 0'), '0 18 * * 0');
});

test('scheduleStringToCron throws on unrecognised string', () => {
  assert.throws(() => scheduleStringToCron('banana'), /Unrecognised schedule/);
});
