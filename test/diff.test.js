const { test } = require('node:test');
const assert = require('node:assert');
const { diffEvents } = require('../src/diff.js');

test('diffEvents should detect new events', () => {
  const previous = [];
  const current = [
    { id: 'e1', title: 'New Event', start: new Date(), end: new Date() }
  ];

  const diffs = diffEvents(previous, current);
  assert.strictEqual(diffs.length, 1);
  assert.strictEqual(diffs[0].type, 'new');
  assert.strictEqual(diffs[0].event.id, 'e1');
});

test('diffEvents should detect deleted events', () => {
  const previous = [
    { id: 'e1', title: 'Old Event', start: new Date(), end: new Date() }
  ];
  const current = [];

  const diffs = diffEvents(previous, current);
  assert.strictEqual(diffs.length, 1);
  assert.strictEqual(diffs[0].type, 'deleted');
  assert.strictEqual(diffs[0].event.id, 'e1');
});

test('diffEvents should detect time changes', () => {
  const oldStart = new Date('2026-03-25T09:00:00Z');
  const newStart = new Date('2026-03-25T10:00:00Z');

  const previous = [
    { id: 'e1', title: 'Event', start: oldStart, end: new Date(), location: 'Room A' }
  ];
  const current = [
    { id: 'e1', title: 'Event', start: newStart, end: new Date(), location: 'Room A' }
  ];

  const diffs = diffEvents(previous, current);
  assert.strictEqual(diffs.length, 1);
  assert.strictEqual(diffs[0].type, 'time_changed');
  assert.deepStrictEqual(diffs[0].old.start, oldStart);
  assert.deepStrictEqual(diffs[0].new.start, newStart);
});

test('diffEvents should detect title changes', () => {
  const previous = [
    { id: 'e1', title: 'Old Title', start: new Date(), end: new Date() }
  ];
  const current = [
    { id: 'e1', title: 'New Title', start: new Date(), end: new Date() }
  ];

  const diffs = diffEvents(previous, current);
  assert.strictEqual(diffs.length, 1);
  assert.strictEqual(diffs[0].type, 'title_changed');
});

test('diffEvents should detect location changes', () => {
  const previous = [
    { id: 'e1', title: 'Event', start: new Date(), end: new Date(), location: 'Room A' }
  ];
  const current = [
    { id: 'e1', title: 'Event', start: new Date(), end: new Date(), location: 'Room B' }
  ];

  const diffs = diffEvents(previous, current);
  assert.strictEqual(diffs.length, 1);
  assert.strictEqual(diffs[0].type, 'location_changed');
});

test('diffEvents should ignore description changes', () => {
  const previous = [
    { id: 'e1', title: 'Event', start: new Date(), end: new Date(), description: 'Old desc' }
  ];
  const current = [
    { id: 'e1', title: 'Event', start: new Date(), end: new Date(), description: 'New desc' }
  ];

  const diffs = diffEvents(previous, current);
  assert.strictEqual(diffs.length, 0); // Description changes are ignored
});

test('diffEvents should detect no changes for identical events', () => {
  const event = { id: 'e1', title: 'Event', start: new Date(), end: new Date() };
  const previous = [event];
  const current = [{ ...event }];

  const diffs = diffEvents(previous, current);
  assert.strictEqual(diffs.length, 0);
});

test('diffEvents should detect single change in recurring event instances', () => {
  // Simulate a recurring event with 5 instances (same UID, different dates)
  // This reproduces the bug from issue #16
  const baseUid = 'recurring-event-uid';

  // Previous state: 5 weekly occurrences on Wednesdays
  const previous = [
    { id: baseUid, title: 'Weekly Meeting', start: new Date('2026-04-01T21:00:00Z'), end: new Date('2026-04-01T22:30:00Z'), rrule: 'FREQ=WEEKLY' },
    { id: baseUid, title: 'Weekly Meeting', start: new Date('2026-04-08T21:00:00Z'), end: new Date('2026-04-08T22:30:00Z'), rrule: 'FREQ=WEEKLY' },
    { id: baseUid, title: 'Weekly Meeting', start: new Date('2026-04-15T21:00:00Z'), end: new Date('2026-04-15T22:30:00Z'), rrule: 'FREQ=WEEKLY' },
    { id: baseUid, title: 'Weekly Meeting', start: new Date('2026-04-22T21:00:00Z'), end: new Date('2026-04-22T22:30:00Z'), rrule: 'FREQ=WEEKLY' },
    { id: baseUid, title: 'Weekly Meeting', start: new Date('2026-04-29T21:00:00Z'), end: new Date('2026-04-29T22:30:00Z'), rrule: 'FREQ=WEEKLY' }
  ];

  // Current state: ONE instance modified (April 1 moved to Tuesday instead of Wednesday)
  const current = [
    { id: baseUid, title: 'Weekly Meeting', start: new Date('2026-03-31T21:00:00Z'), end: new Date('2026-03-31T22:30:00Z'), rrule: 'FREQ=WEEKLY' }, // Modified: Tuesday instead of Wednesday
    { id: baseUid, title: 'Weekly Meeting', start: new Date('2026-04-08T21:00:00Z'), end: new Date('2026-04-08T22:30:00Z'), rrule: 'FREQ=WEEKLY' },
    { id: baseUid, title: 'Weekly Meeting', start: new Date('2026-04-15T21:00:00Z'), end: new Date('2026-04-15T22:30:00Z'), rrule: 'FREQ=WEEKLY' },
    { id: baseUid, title: 'Weekly Meeting', start: new Date('2026-04-22T21:00:00Z'), end: new Date('2026-04-22T22:30:00Z'), rrule: 'FREQ=WEEKLY' },
    { id: baseUid, title: 'Weekly Meeting', start: new Date('2026-04-29T21:00:00Z'), end: new Date('2026-04-29T22:30:00Z'), rrule: 'FREQ=WEEKLY' }
  ];

  const diffs = diffEvents(previous, current);

  // Should detect EXACTLY 1 change: April 1 (Wed) deleted + March 31 (Tue) added
  // But current implementation will see confusing results due to Map deduplication
  assert.strictEqual(diffs.length, 2, 'Should detect 1 deleted and 1 new instance');

  const deletedDiff = diffs.find(d => d.type === 'deleted');
  const newDiff = diffs.find(d => d.type === 'new');

  assert.ok(deletedDiff, 'Should have a deleted event');
  assert.ok(newDiff, 'Should have a new event');

  // The deleted event should be April 1 (Wednesday)
  assert.strictEqual(deletedDiff.event.start.toISOString(), '2026-04-01T21:00:00.000Z');

  // The new event should be March 31 (Tuesday)
  assert.strictEqual(newDiff.event.start.toISOString(), '2026-03-31T21:00:00.000Z');
});
