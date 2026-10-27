import { describe, expect, it } from 'vitest';
import { addPlane, defaultDoc, emptyDoc, MAX_PLANES, parseDoc, removePlane, showcaseDoc, updatePlane, type PlaneRecord } from '../../src/state/document';
import { commit, createHistory, redo, undo, canUndo, canRedo } from '../../src/state/history';
import { surfaceHeight } from '../../src/scene/town';
import { straightPath } from './fixtures';

const plane = (id: string): PlaneRecord => ({ id, path: straightPath(), landed: null, seed: 1 });

describe('document', () => {
  it('round-trips through JSON', () => {
    const doc = addPlane(emptyDoc(), { ...plane('a'), landed: { x: 1, y: 0.2, z: 2, heading: 0.5 } });
    expect(parseDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it('rejects the wrong shape or version', () => {
    expect(parseDoc(null)).toBeNull();
    expect(parseDoc({ version: 2, planes: [] })).toBeNull();
    expect(parseDoc({ version: 1 })).toBeNull();
    expect(parseDoc('{"version":1}')).toBeNull();
  });

  it('drops bad planes and keeps good ones', () => {
    const good = plane('good');
    const raw = {
      version: 1,
      planes: [
        good,
        { ...plane('nan'), path: [[NaN, 1, 1, 3], [0, 1, 0, 3]] },
        { ...plane('far'), path: [[1e6, 1, 1, 3], [0, 1, 0, 3]] },
        { ...plane('short'), path: [[0, 1, 0, 3]] },
        { ...plane('speed'), path: [[0, 1, 0, -2], [1, 1, 0, 3]] },
        { ...plane('landed'), landed: { x: 'a' } },
        { id: 'noseed', path: good.path, landed: null },
        good, // a duplicate id
        42,
      ],
    };
    const doc = parseDoc(raw)!;
    expect(doc.planes.map((p) => p.id)).toEqual(['good']);
  });

  it('caps the sky at eight planes; the oldest makes room', () => {
    let doc = emptyDoc();
    for (let i = 0; i < MAX_PLANES + 3; i++) doc = addPlane(doc, plane(`p${i}`));
    expect(doc.planes).toHaveLength(MAX_PLANES);
    expect(doc.planes[0].id).toBe('p3');
    const parsed = parseDoc({ version: 1, planes: Array.from({ length: 20 }, (_, i) => plane(`q${i}`)) })!;
    expect(parsed.planes).toHaveLength(MAX_PLANES);
  });

  it('edits are immutable', () => {
    const a = addPlane(emptyDoc(), plane('a'));
    const b = updatePlane(a, 'a', { landed: { x: 0, y: 0.1, z: 0, heading: 0 } });
    expect(a.planes[0].landed).toBeNull();
    expect(b.planes[0].landed).not.toBeNull();
    expect(removePlane(b, 'a').planes).toHaveLength(0);
    expect(b.planes).toHaveLength(1);
  });

  it('first visit rests two planes on real surfaces; the showcase flies four', () => {
    const d = defaultDoc();
    expect(d.planes).toHaveLength(2);
    for (const p of d.planes) expect(p.landed!.y).toBeGreaterThan(surfaceHeight(p.landed!.x, p.landed!.z));
    expect(parseDoc(JSON.parse(JSON.stringify(d)))).toEqual(d);
    const s = showcaseDoc();
    expect(s.planes.length).toBeGreaterThanOrEqual(3);
    expect(s.planes.every((p) => p.landed === null)).toBe(true);
    expect(s.planes[0].path.some((q) => q[4] === 1)).toBe(true); // a loop
  });
});

describe('history', () => {
  it('undoes and redoes edits', () => {
    let h = createHistory(emptyDoc());
    expect(canUndo(h)).toBe(false);
    h = commit(h, addPlane(h.present, plane('a')));
    h = commit(h, addPlane(h.present, plane('b')));
    h = undo(h);
    expect(h.present.planes.map((p) => p.id)).toEqual(['a']);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.present.planes).toHaveLength(2);
    h = undo(undo(h));
    expect(h.present.planes).toHaveLength(0);
    // a new edit after undo drops the redo branch
    h = commit(h, addPlane(h.present, plane('c')));
    expect(canRedo(h)).toBe(false);
  });
});
