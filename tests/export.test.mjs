import assert from 'node:assert/strict';
import { build } from 'esbuild';
const result = await build({ entryPoints: ['src/markdown-export.ts'], bundle: true, write: false, format: 'esm' });
const { selectedComments, markdownFiles, safeExportName, exportFolder, exportFileName, MarkdownExportJob } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const annotation = (id, page, y, title = 'A concept') => ({ id, page, title, text: 'First **line**\r\n\r\n  <second> & last', comment: 'My **Markdown**.\n\n- Keep this list\n- And this item', category: 'concept', categoryLabel: 'Concept & [idea]', tags: ['two words', 'a/b', '#important'], quads: [{ x: 20, y, w: 30, h: 10 }], createdAt: 1, updatedAt: 1 });
const a = annotation('a & #', 1, 100), b = annotation('b', 1, 200), c = annotation('c', 2, 50, '中文 / Résumé?');
const data = { annotations: [c, b, a], notes: 'Notes\n\n**Preserved**', canvasLayout: { groups: [{ id: 'g', members: ['p:1', 'a:c'] }] } };
const before = structuredClone(data);
assert.deepEqual(selectedComments(data, new Set(['p:1', 'a:a & #'])).map(a => a.id), [a.id, b.id], 'Pages include all comments and overlap is deduplicated');
assert.deepEqual(selectedComments(data, new Set(['g:g', 'a:b'])).map(a => a.id), [a.id, b.id, c.id], 'Groups expand pages and cards once');
assert.deepEqual(selectedComments(data, new Set(['a:missing', 'p:9'])), [], 'Empty/stale selections do not export unrelated comments');
const snapshot = { pdfPath: 'Papers/Über [A] #1 (draft).pdf', vaultName: 'My Vault & more', notes: data.notes, comments: [a, b, c] };
const options = { mode: 'combined', folder: 'Exports/Notes', name: 'Selected notes.md', includeNotes: true };
const [combined] = markdownFiles(snapshot, options);
assert.equal(combined.name, 'Selected notes.md');
assert.match(combined.content, /## Document notes\n\nNotes\n\n\*\*Preserved\*\*/);
assert.ok(combined.content.indexOf('## Page 1') < combined.content.indexOf('## Page 2'));
assert.ok(combined.content.includes('### A concept (2)'), 'Duplicate headings are disambiguated for Canvas cards');
assert.ok(combined.content.includes('> First \\*\\*line\\*\\*\n> \n>   &lt;second&gt; &amp; last'), 'PDF quotes preserve lines and indentation, without interpreting Markdown or HTML');
assert.ok(combined.content.includes(a.comment), 'Comment Markdown remains editable');
assert.ok(combined.content.includes('Category: Concept &amp; \\[idea\\]'));
assert.ok(combined.content.includes('Tags: two words, a/b, \\#important'));
const pdf = combined.content.match(/\[PDF · page 1\]\(<([^>]+)>\)/)[1];
assert.equal(new URL(pdf, 'https://vault.test/Exports/Notes/note.md').pathname, '/Papers/%C3%9Cber%20%5BA%5D%20%231%20%28draft%29.pdf');
const uri = new URL(combined.content.match(/\[Open comment\]\(<([^>]+)>\)/)[1]);
assert.equal(uri.searchParams.get('file'), snapshot.pdfPath); assert.equal(uri.searchParams.get('vault'), snapshot.vaultName); assert.equal(uri.searchParams.get('comment'), a.id);
assert.ok(!markdownFiles(snapshot, { ...options, includeNotes: false })[0].content.includes('## Document notes'));
const individual = markdownFiles(snapshot, { ...options, mode: 'individual' });
assert.equal(individual.length, 4); assert.equal(individual[3].name, 'Document notes.md');
assert.ok(individual[2].name.includes('中文')); assert.ok(!individual[2].name.includes('/'));
assert.ok(individual.slice(0, 3).every(file => !file.content.includes('**Preserved**')), 'Document notes get their own file');
assert.equal(safeExportName('CON'), '_CON'); assert.ok(new TextEncoder().encode(safeExportName('😀'.repeat(150))).length <= 140);
assert.equal(exportFolder('Exports\\Nested/'), 'Exports/Nested'); assert.equal(exportFolder(''), '');
for (const value of ['../outside', '/outside', '/', 'C:\\outside', 'Exports/../other', '.obsidian', 'Exports/.hidden', 'bad\u0000path']) assert.throws(() => exportFolder(value));
for (const value of ['../note', 'CON', 'a/b', '', '.hidden', 'bad#name']) assert.throws(() => exportFileName(value));
assert.throws(() => markdownFiles({ ...snapshot, comments: [] }, options));
assert.deepEqual(data, before, 'Export never mutates annotation/layout data');

function fakeVault() {
  const entries = new Map(), contents = new Map();
  const vault = {
    entries, contents, failAfter: Infinity, writes: 0,
    getAllLoadedFiles: () => [...entries.values()], getAbstractFileByPath: path => entries.get(path) ?? null,
    createFolder: async path => { const folder = { path, children: [] }; entries.set(path, folder); return folder; },
    create: async (path, content) => {
      if (entries.has(path)) throw new Error('Exists');
      if (vault.writes === vault.failAfter) throw new Error('Disk full');
      vault.writes++; const file = { path }; entries.set(path, file); contents.set(path, content); return file;
    },
  };
  return vault;
}
const vault = fakeVault();
await vault.createFolder('Exports'); await vault.createFolder('Exports/Notes');
await vault.create('Exports/Notes/SELECTED NOTES.md', 'Keep existing content');
const job = new MarkdownExportJob(snapshot, options);
assert.deepEqual(await job.run(vault), ['Exports/Notes/Selected notes (2).md']);
assert.equal(vault.contents.get('Exports/Notes/SELECTED NOTES.md'), 'Keep existing content');
const caseVault = fakeVault(); await caseVault.createFolder('Papers'); await caseVault.createFolder('Papers/Notes');
const caseJob = new MarkdownExportJob(snapshot, { ...options, folder: 'papers/notes' });
await caseJob.run(caseVault);
assert.equal(caseJob.folder, 'Papers/Notes');
assert.ok(caseVault.contents.get(caseJob.written[0]).includes('(<../%C3%9Cber'), 'Source links use the actual spelling of existing folders');
const differentCase = markdownFiles(snapshot, { ...options, folder: 'papers/Notes' });
assert.ok(differentCase[0].content.includes('(<../../Papers/'), 'Distinct source folder spelling is not silently treated as the same path');
const retryVault = fakeVault(), retry = new MarkdownExportJob(snapshot, { ...options, mode: 'individual' });
retryVault.failAfter = 1;
await assert.rejects(() => retry.run(retryVault), /Disk full/); assert.equal(retry.written.length, 1);
retryVault.failAfter = Infinity;
await retry.run(retryVault);
assert.equal(retry.written.length, 4); assert.equal(retryVault.contents.size, 4, 'Retry resumes without duplicating completed files');
assert.ok(retry.written[1].endsWith('A concept (2).md'), 'Duplicate titles get distinct file names');
await retry.run(retryVault); assert.equal(retryVault.contents.size, 4, 'A completed job is idempotent');
const collision = fakeVault(); await collision.create('Exports', 'A file, not a folder');
await assert.rejects(() => new MarkdownExportJob(snapshot, options).run(collision), /folder name/);
assert.equal(collision.contents.size, 1);
const raced = fakeVault(), create = raced.create;
let first = true;
raced.create = async (path, content) => { if (first) { first = false; await create(path, 'Concurrent file'); throw new Error('Exists'); } return create(path, content); };
const raceJob = new MarkdownExportJob(snapshot, { ...options, folder: '' });
await raceJob.run(raced);
assert.equal(raced.contents.get('Selected notes.md'), 'Concurrent file');
assert.deepEqual(raceJob.written, ['Selected notes (2).md']);
console.log('PASS: export selection/pages/groups, deduplication, Markdown/Unicode/source links, document notes, safe paths, collision protection and retry after partial writes');
