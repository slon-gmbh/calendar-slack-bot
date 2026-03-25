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
