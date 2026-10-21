import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
const result = await build({entryPoints:['src/model.ts'],bundle:true,write:false,format:'esm'});
const code = result.outputFiles[0].text;
const { readSidecar, connection, sceneBounds, fitCamera, defaultPosition } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const annotation = { id: 'legacy', page: 2, color: 'red', quads: [{ x: 120, y: 250, w: 80, h: 20 }], text: 'Original text', comment: 'Keep this', createdAt: 1, updatedAt: 2 };
const original = { version: 1, pdfPath: 'old.pdf', notes: 'Original notes', annotations: [annotation] };
const migrated = readSidecar(JSON.stringify(original), 'renamed.pdf');
assert.equal(migrated.version, 2);
assert.equal(migrated.pdfPath, 'renamed.pdf');
assert.equal(migrated.notes, original.notes);
assert.equal(migrated.annotations[0].category, 'limitation');
assert.equal(migrated.annotations[0].comment, annotation.comment);
assert.deepEqual(migrated.annotations[0].quads, annotation.quads);
migrated.annotations[0].position = { x: -550, y: 1240 };
migrated.annotations[0].tags = ['Methodik'];
assert.deepEqual(readSidecar(JSON.stringify(migrated), 'renamed.pdf'), migrated);
for (const invalid of [null, { ...original, version: 99 }, { ...original, annotations: [annotation, annotation] }, { ...original, annotations: [{ ...annotation, quads: [] }] }, { ...original, annotations: [{ ...annotation, position: { x: null, y: 2 } }] }, { ...original, annotations: [{ ...annotation, category: 'constructor' }] }]) {
  assert.throws(() => readSidecar(JSON.stringify(invalid), 'test.pdf'));
}
assert.throws(() => readSidecar('{broken json', 'test.pdf'));
for (const [color, category] of Object.entries({ red: 'limitation', yellow: 'note', green: 'evidence', blue: 'method' })) {
  assert.equal(readSidecar(JSON.stringify({ ...original, annotations: [{ ...annotation, color }] }), 'test.pdf').annotations[0].category, category);
}
for (const [oldCategory, category] of Object.entries({ criticism: 'limitation', question: 'note', positive: 'evidence', unclear: 'note', literature: 'evidence', method: 'method' })) {
  const saved = { ...annotation, category: oldCategory, position: { x: -400, y: 70 }, tags: ['Original tag'], title: 'Original title' };
  const result = readSidecar(JSON.stringify({ ...original, version: 2, annotations: [saved] }), 'test.pdf').annotations[0];
  assert.equal(result.category, category);
  for (const key of ['position', 'quads', 'tags', 'text', 'comment', 'title']) assert.deepEqual(result[key], saved[key]);
}
for (const category of ['claim', 'evidence', 'method', 'concept', 'limitation', 'note']) {
  assert.equal(readSidecar(JSON.stringify({ ...original, version: 2, annotations: [{ ...annotation, category }] }), 'test.pdf').annotations[0].category, category);
}
const quad = annotation.quads[0];
assert.deepEqual(connection({ x: -400, y: 20, width: 300, height: 200 }, quad).anchor, { x: 120, y: 260 });
assert.deepEqual(connection({ x: 900, y: 20, width: 300, height: 200 }, quad).anchor, { x: 200, y: 260 });
const cards = [{ x: -800, y: -300, width: 300, height: 350 }, { x: 1500, y: 1700, width: 300, height: 260 }];
const bounds = sceneBounds(800, 1100, cards);
const camera = fitCamera(bounds, 1400, 800);
for (const box of [{ x: 0, y: 0, width: 800, height: 1100 }, ...cards]) {
  assert.ok(box.x * camera.zoom + camera.x >= 0);
  assert.ok(box.y * camera.zoom + camera.y >= 0);
  assert.ok((box.x + box.width) * camera.zoom + camera.x <= 1400);
  assert.ok((box.y + box.height) * camera.zoom + camera.y <= 800);
}
assert.ok(defaultPosition(0, 800).x < 0);
assert.ok(defaultPosition(1, 800).x > 800);
console.log('PASS: legacy migration, roundtrip, invalid data protection, connector anchors and camera bounds');

for (const changes of [{ page: "2" }, { category: {} }, { tags: [42] }, { quads: [null] }, { quads: [{x: 1, y: 2, w: -1, h: 2}] }, { position: [] }, { title: 7 }]) {
  assert.throws(() => readSidecar(JSON.stringify({ ...original, annotations: [{ ...annotation, ...changes }] }), "test.pdf"));
}
