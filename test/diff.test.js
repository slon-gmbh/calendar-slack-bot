const { test } = require('node:test');
const assert = require('node:assert');
const { diffEvents, loadPendingNotifications, savePendingNotifications } = require('../src/diff.js');
const { openDb } = require('../src/db.js');

test('diffEvents should detect new events', () => {
  const previous = [];
  const current = [
    {
      id: 'e1',
      title: 'New Event',
      location: null,
      description: null,
      isAllDay: false,
      rrule: null,
      instances: [{ start: new Date(), end: new Date(), isException: false }]
    }
  ];

  const diffs = diffEvents(previous, current);
  assert.strictEqual(diffs.length, 1);
  assert.strictEqual(diffs[0].type, 'new');
  assert.strictEqual(diffs[0].event.id, 'e1');
});

test('diffEvents should detect deleted events', () => {
  const previous = [
    {
      id: 'e1',
      title: 'Old Event',
      location: null,
      description: null,
      isAllDay: false,
      rrule: null,
      instances: [{ start: new Date(), end: new Date(), isException: false }]
    }
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
  const endDate = new Date();

  const previous = [
    {
      id: 'e1',
      title: 'Event',
      location: 'Room A',
      description: null,
      isAllDay: false,
      rrule: null,
      instances: [{ start: oldStart, end: endDate, isException: false }]
    }
  ];
  const current = [
    {
      id: 'e1',
      title: 'Event',
      location: 'Room A',
      description: null,
      isAllDay: false,
      rrule: null,
      instances: [{ start: newStart, end: endDate, isException: false }]
    }
  ];

  const diffs = diffEvents(previous, current);
  assert.strictEqual(diffs.length, 1);
  assert.strictEqual(diffs[0].type, 'time_changed');
  assert.deepStrictEqual(diffs[0].old.start, oldStart);
  assert.deepStrictEqual(diffs[0].new.start, newStart);
});

test('diffEvents should detect title changes', () => {
  const startDate = new Date();
  const endDate = new Date();

  const previous = [
    {
      id: 'e1',
      title: 'Old Title',
      location: null,
      description: null,
      isAllDay: false,
      rrule: null,
      instances: [{ start: startDate, end: endDate, isException: false }]
    }
  ];
  const current = [
    {
      id: 'e1',
      title: 'New Title',
      location: null,
      description: null,
      isAllDay: false,
      rrule: null,
      instances: [{ start: startDate, end: endDate, isException: false }]
    }
  ];

  const diffs = diffEvents(previous, current);
  assert.strictEqual(diffs.length, 1);
  assert.strictEqual(diffs[0].type, 'title_changed');
});

test('diffEvents should detect location changes', () => {
  const startDate = new Date();
  const endDate = new Date();

  const previous = [
    {
      id: 'e1',
      title: 'Event',
      location: 'Room A',
      description: null,
      isAllDay: false,
      rrule: null,
      instances: [{ start: startDate, end: endDate, isException: false }]
    }
  ];
  const current = [
    {
      id: 'e1',
      title: 'Event',
      location: 'Room B',
      description: null,
      isAllDay: false,
      rrule: null,
      instances: [{ start: startDate, end: endDate, isException: false }]
    }
  ];

  const diffs = diffEvents(previous, current);
  assert.strictEqual(diffs.length, 1);
  assert.strictEqual(diffs[0].type, 'location_changed');
});

test('diffEvents should ignore description changes', () => {
  const startDate = new Date();
  const endDate = new Date();

  const previous = [
    {
      id: 'e1',
      title: 'Event',
      location: null,
      description: 'Old desc',
      isAllDay: false,
      rrule: null,
      instances: [{ start: startDate, end: endDate, isException: false }]
    }
  ];
  const current = [
    {
      id: 'e1',
      title: 'Event',
      location: null,
      description: 'New desc',
      isAllDay: false,
      rrule: null,
      instances: [{ start: startDate, end: endDate, isException: false }]
    }
  ];

  const diffs = diffEvents(previous, current);
  assert.strictEqual(diffs.length, 0); // Description changes are ignored
});

test('diffEvents should detect no changes for identical events', () => {
  const startDate = new Date();
  const endDate = new Date();
  const event = {
    id: 'e1',
    title: 'Event',
    location: null,
    description: null,
    isAllDay: false,
    rrule: null,
    instances: [{ start: startDate, end: endDate, isException: false }]
  };
  const previous = [event];
  const current = [{ ...event, instances: [{ ...event.instances[0] }] }];

  const diffs = diffEvents(previous, current);
  assert.strictEqual(diffs.length, 0);
});

test('diffEvents should group recurring events by ID (composite structure)', () => {
  // With composite structure, a recurring event with 5 instances is ONE event, not 5
  const baseUid = 'recurring-event-uid';

  // Previous state: 1 recurring event with 5 instances
  const previous = [{
    id: baseUid,
    title: 'Weekly Meeting',
    location: null,
    description: null,
    isAllDay: false,
    rrule: 'FREQ=WEEKLY',
    instances: [
      { start: new Date('2026-04-01T21:00:00Z'), end: new Date('2026-04-01T22:30:00Z'), isException: false },
      { start: new Date('2026-04-08T21:00:00Z'), end: new Date('2026-04-08T22:30:00Z'), isException: false },
      { start: new Date('2026-04-15T21:00:00Z'), end: new Date('2026-04-15T22:30:00Z'), isException: false },
      { start: new Date('2026-04-22T21:00:00Z'), end: new Date('2026-04-22T22:30:00Z'), isException: false },
      { start: new Date('2026-04-29T21:00:00Z'), end: new Date('2026-04-29T22:30:00Z'), isException: false }
    ]
  }];

  // Current state: same recurring event with different instances
  const current = [{
    id: baseUid,
    title: 'Weekly Meeting',
    location: null,
    description: null,
    isAllDay: false,
    rrule: 'FREQ=WEEKLY',
    instances: [
      { start: new Date('2026-04-08T21:00:00Z'), end: new Date('2026-04-08T22:30:00Z'), isException: false },
      { start: new Date('2026-04-15T21:00:00Z'), end: new Date('2026-04-15T22:30:00Z'), isException: false },
      { start: new Date('2026-04-22T21:00:00Z'), end: new Date('2026-04-22T22:30:00Z'), isException: false },
      { start: new Date('2026-04-29T21:00:00Z'), end: new Date('2026-04-29T22:30:00Z'), isException: false },
      { start: new Date('2026-05-06T21:00:00Z'), end: new Date('2026-05-06T22:30:00Z'), isException: false }
    ]
  }];

  const diffs = diffEvents(previous, current);

  // Since RRULE is the same (both FREQ=WEEKLY), should be 0 diffs
  assert.strictEqual(diffs.length, 0, 'Same RRULE = no diff');
});

test('diffEvents should detect new recurring event as single diff (composite structure)', () => {
  const previous = [];
  const current = [{
    id: 'recurring-123',
    title: 'Weekly Meeting',
    location: null,
    description: null,
    isAllDay: false,
    rrule: 'FREQ=WEEKLY;BYDAY=TH',
    instances: [
      { start: new Date('2026-04-03T10:00:00Z'), end: new Date('2026-04-03T11:00:00Z'), isException: false },
      { start: new Date('2026-04-10T10:00:00Z'), end: new Date('2026-04-10T11:00:00Z'), isException: false },
      { start: new Date('2026-04-17T10:00:00Z'), end: new Date('2026-04-17T11:00:00Z'), isException: false }
    ]
  }];

  const diffs = diffEvents(previous, current);

  assert.strictEqual(diffs.length, 1, 'Should be 1 diff for recurring event, not 3');
  assert.strictEqual(diffs[0].type, 'new');
  assert.strictEqual(diffs[0].event.id, 'recurring-123');
  assert.strictEqual(diffs[0].event.rrule, 'FREQ=WEEKLY;BYDAY=TH');
});

test('diffEvents should detect RRULE pattern change (composite structure)', () => {
  const previous = [{
    id: 'event-123',
    title: 'Meeting',
    location: null,
    description: null,
    isAllDay: false,
    rrule: 'FREQ=WEEKLY;BYDAY=TH',
    instances: [
      { start: new Date('2026-04-03T10:00:00Z'), end: new Date('2026-04-03T11:00:00Z'), isException: false }
    ]
  }];

  const current = [{
    id: 'event-123',
    title: 'Meeting',
    location: null,
    description: null,
    isAllDay: false,
    rrule: 'FREQ=DAILY',
    instances: [
      { start: new Date('2026-04-03T10:00:00Z'), end: new Date('2026-04-03T11:00:00Z'), isException: false },
      { start: new Date('2026-04-04T10:00:00Z'), end: new Date('2026-04-04T11:00:00Z'), isException: false }
    ]
  }];

  const diffs = diffEvents(previous, current);

  assert.strictEqual(diffs.length, 1);
  assert.strictEqual(diffs[0].type, 'pattern_changed');
  assert.strictEqual(diffs[0].old.rrule, 'FREQ=WEEKLY;BYDAY=TH');
  assert.strictEqual(diffs[0].new.rrule, 'FREQ=DAILY');
});

test('diffEvents should not generate multiple diffs for recurring event instances (composite structure)', () => {
  const previous = [];
  const current = [{
    id: 'recurring-456',
    title: 'Daily Standup',
    location: null,
    description: null,
    isAllDay: false,
    rrule: 'FREQ=DAILY',
    instances: [
      { start: new Date('2026-04-01T09:00:00Z'), end: new Date('2026-04-01T09:15:00Z'), isException: false },
      { start: new Date('2026-04-02T09:00:00Z'), end: new Date('2026-04-02T09:15:00Z'), isException: false },
      { start: new Date('2026-04-03T09:00:00Z'), end: new Date('2026-04-03T09:15:00Z'), isException: false },
      { start: new Date('2026-04-04T09:00:00Z'), end: new Date('2026-04-04T09:15:00Z'), isException: false },
      { start: new Date('2026-04-05T09:00:00Z'), end: new Date('2026-04-05T09:15:00Z'), isException: false }
    ]
  }];

  const diffs = diffEvents(previous, current);

  // Should be 1 diff, not 5
  assert.strictEqual(diffs.length, 1, 'Should be 1 diff for 5 instances of same recurring event');
  assert.strictEqual(diffs[0].type, 'new');
});

test('diffEvents should handle single-instance events with instances array (composite structure)', () => {
  const previous = [];
  const current = [{
    id: 'single-123',
    title: 'One-time Event',
    location: null,
    description: null,
    isAllDay: false,
    rrule: null,
    instances: [
      { start: new Date('2026-04-03T14:00:00Z'), end: new Date('2026-04-03T15:00:00Z'), isException: false }
    ]
  }];

  const diffs = diffEvents(previous, current);

  assert.strictEqual(diffs.length, 1);
  assert.strictEqual(diffs[0].type, 'new');
  assert.strictEqual(diffs[0].event.id, 'single-123');
});

test('diffEvents should NOT detect change when RRULE has malformed DTSTART prefix (issue #16)', () => {
  // Bug: Old cache has RRULE with DTSTART prefix, new cache has clean RRULE
  // This causes false positive change detection
  const previous = [{
    id: 'recurring-eurythmie',
    title: 'EG | Eurythmie (mit Friederike)',
    location: null,
    description: null,
    isAllDay: false,
    rrule: 'DTSTART;TZID=Europe/Berlin:20260114T100000\nRRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20260708T090000',
    instances: [
      { start: new Date('2026-04-15T10:00:00Z'), end: new Date('2026-04-15T11:00:00Z'), isException: false }
    ]
  }];

  const current = [{
    id: 'recurring-eurythmie',
    title: 'EG | Eurythmie (mit Friederike)',
    location: null,
    description: null,
    isAllDay: false,
    rrule: 'FREQ=WEEKLY;BYDAY=WE;UNTIL=20260708T090000',
    instances: [
      { start: new Date('2026-04-15T10:00:00Z'), end: new Date('2026-04-15T11:00:00Z'), isException: false }
    ]
  }];

  const diffs = diffEvents(previous, current);

  // Should detect NO changes - both RRULEs represent same pattern
  assert.strictEqual(diffs.length, 0, 'Malformed RRULE with DTSTART prefix should normalize to same pattern');
});

test('diffEvents should detect REAL RRULE pattern changes (issue #16)', () => {
  // Ensure we still detect actual pattern changes
  const previous = [{
    id: 'recurring-meeting',
    title: 'Weekly Meeting',
    location: null,
    description: null,
    isAllDay: false,
    rrule: 'FREQ=WEEKLY;BYDAY=MO',
    instances: [
      { start: new Date('2026-04-14T10:00:00Z'), end: new Date('2026-04-14T11:00:00Z'), isException: false }
    ]
  }];

  const current = [{
    id: 'recurring-meeting',
    title: 'Weekly Meeting',
    location: null,
    description: null,
    isAllDay: false,
    rrule: 'FREQ=WEEKLY;BYDAY=WE',
    instances: [
      { start: new Date('2026-04-16T10:00:00Z'), end: new Date('2026-04-16T11:00:00Z'), isException: false }
    ]
  }];

  const diffs = diffEvents(previous, current);

  // Should detect pattern change: Monday → Wednesday
  assert.strictEqual(diffs.length, 1);
  assert.strictEqual(diffs[0].type, 'pattern_changed');
  assert.strictEqual(diffs[0].old.rrule, 'FREQ=WEEKLY;BYDAY=MO');
  assert.strictEqual(diffs[0].new.rrule, 'FREQ=WEEKLY;BYDAY=WE');
});

test('diffEvents should handle malformed RRULE in both old and new (issue #16)', () => {
  // Edge case: both have malformed format
  const previous = [{
    id: 'recurring-event',
    title: 'Test Event',
    location: null,
    description: null,
    isAllDay: false,
    rrule: 'DTSTART;TZID=Europe/Berlin:20260114T100000\nRRULE:FREQ=DAILY',
    instances: [
      { start: new Date('2026-04-15T10:00:00Z'), end: new Date('2026-04-15T11:00:00Z'), isException: false }
    ]
  }];

  const current = [{
    id: 'recurring-event',
    title: 'Test Event',
    location: null,
    description: null,
    isAllDay: false,
    rrule: 'DTSTART;TZID=Europe/Berlin:20260115T100000\nRRULE:FREQ=DAILY',
    instances: [
      { start: new Date('2026-04-15T10:00:00Z'), end: new Date('2026-04-15T11:00:00Z'), isException: false }
    ]
  }];

  const diffs = diffEvents(previous, current);

  // Should detect NO changes - RRULE pattern is the same (FREQ=DAILY)
  // DTSTART difference should be ignored
  assert.strictEqual(diffs.length, 0, 'Both malformed RRULEs should normalize to same pattern');
});

test('savePendingNotifications and loadPendingNotifications round-trip within window', () => {
  const db = openDb(':memory:');
  const diffs = [{ type: 'new', event: { id: 'e1', title: 'New' } }];
  savePendingNotifications(db, 'T_TEST', 'C123', diffs);
  const result = loadPendingNotifications(db, 'T_TEST', 'C123');
  assert.strictEqual(result.expired, false);
  assert.strictEqual(result.diffs.length, 1);
  assert.strictEqual(result.diffs[0].type, 'new');
  db.close();
});

test('loadPendingNotifications returns empty for unknown channel', () => {
  const db = openDb(':memory:');
  const result = loadPendingNotifications(db, 'T_TEST', 'C999');
  assert.strictEqual(result.expired, false);
  assert.deepStrictEqual(result.diffs, []);
  db.close();
});

test('workspace isolation: pending notifications not visible across workspaces', () => {
  const db = openDb(':memory:');
  savePendingNotifications(db, 'T_A', 'C123', [{ type: 'new' }]);
  const result = loadPendingNotifications(db, 'T_B', 'C123');
  assert.deepStrictEqual(result.diffs, []);
  db.close();
});
