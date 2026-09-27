import { describe, expect, it } from 'vitest';
import type { FileChange } from '../../src/lore/model.js';
import { groupChange, groupChanges } from '../../src/repository/statusModel.js';

function change(overrides: Partial<FileChange>): FileChange {
  return {
    path: 'file.txt',
    kind: 'modified',
    staged: false,
    dirty: false,
    merged: false,
    size: 0,
    ...overrides,
  };
}

describe('groupChange', () => {
  it('puts an unresolved conflict in Merge Changes with the ! letter, regardless of staged', () => {
    const grouped = groupChange(
      change({ staged: true, conflict: { unresolved: true, automerged: false, mine: false, theirs: false } }),
    );
    expect(grouped.group).toBe('merge');
    expect(grouped.letter).toBe('!');
  });

  it('puts a resolved (staged) conflict in Staged Changes, not Merge Changes', () => {
    const grouped = groupChange(
      change({
        staged: true,
        kind: 'modified',
        conflict: { unresolved: false, automerged: false, mine: false, theirs: true },
      }),
    );
    expect(grouped.group).toBe('staged');
    expect(grouped.letter).toBe('M');
  });

  it('puts a staged-then-edited-again file in Staged Changes only, not split across groups', () => {
    // Per docs/spike-findings.md spike S2: Lore reports this as one node with both flags set.
    const grouped = groupChange(change({ staged: true, dirty: true, kind: 'modified' }));
    expect(grouped.group).toBe('staged');
  });

  it('puts a plain dirty (unstaged) change in Changes', () => {
    const grouped = groupChange(change({ dirty: true, kind: 'modified' }));
    expect(grouped.group).toBe('changes');
    expect(grouped.letter).toBe('M');
  });

  it.each([
    ['added', 'staged', 'A'],
    ['added', 'changes', 'U'],
    ['deleted', 'staged', 'D'],
    ['deleted', 'changes', 'D'],
    ['moved', 'staged', 'R'],
    ['copied', 'staged', 'C'],
  ] as const)('kind=%s in group=%s gets letter %s', (kind, group, expectedLetter) => {
    const grouped = groupChange(change({ kind, staged: group === 'staged', dirty: group === 'changes' }));
    expect(grouped.group).toBe(group);
    expect(grouped.letter).toBe(expectedLetter);
  });
});

describe('groupChanges', () => {
  it('maps a list of changes independently', () => {
    const grouped = groupChanges([
      change({ dirty: true, kind: 'added' }),
      change({ staged: true, kind: 'deleted' }),
    ]);
    expect(grouped.map((g) => g.group)).toEqual(['changes', 'staged']);
    expect(grouped.map((g) => g.letter)).toEqual(['U', 'D']);
  });
});
