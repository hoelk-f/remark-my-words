import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

export async function testExport({ evaluate, until, cdp }) {
  const open = () => evaluate(`document.querySelector('button[aria-label="Canvas actions"]').click();lastMenu.items.find(item=>item.text==='Export selection…').action()`);
  const submit = () => evaluate(`document.querySelector('.pdfaw-export-modal .mod-cta').click()`);
  const set = (selector, value) => evaluate(`(() => {const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change'));})()`);
  const exported = prefix => evaluate(`[...storage].filter(([path])=>path.startsWith(${JSON.stringify(prefix)}) && path.endsWith('.md'))`);
  await evaluate(`(async()=>{
    await view.saveQueue;window.beforeExport=structuredClone(view.sidecar);view.setMode('canvas');
    const sample=view.sidecar.annotations[0];
    view.sidecar.annotations=[
      {...sample,id:'export-a',page:1,category:'concept',title:'Same title',comment:'First **comment**',text:'First quote',tags:['two words']},
      {...sample,id:'export-b',page:1,category:'note',title:'Same title',comment:'Second comment',text:'Second quote'},
      {...sample,id:'export-c',page:2,category:'claim',title:'Third title',comment:'Third comment',text:'Third quote'}
    ];
    view.sidecar.notes='Document **notes**';view.sidecar.canvasLayout.groups=[{id:'export-group',name:'Export group',members:['p:1','a:export-c']}];
    view.renderAnnotations();await view.save();window.exportSource=storage.get(view.file.path+'.obsidian-annot.json');
    view.selectedNodes.clear();view.updateSelectionPaint();
    document.querySelector('button[aria-label="Canvas actions"]').click();
  })()`);
  try {
    assert.equal(await evaluate(`lastMenu.items.find(item=>item.text==='Export selection…').disabled`), true, 'Empty selections cannot export');
    await evaluate(`view.selectedNodes=new Set(['p:1','a:export-a']);view.filter='note';view.renderAnnotations()`);
    await open();
    assert.match(await evaluate(`document.querySelector('.pdfaw-export-summary').textContent`), /^2 comments from 1 page/);
    await set('.pdfaw-export-folder', 'Test Exports/Combined'); await set('.pdfaw-export-name', 'Selected');
    await evaluate(`document.querySelector('.pdfaw-export-notes').checked=true;view.selectedNodes=new Set(['a:export-c'])`);
    await submit(); await until(`!document.querySelector('.pdfaw-export-modal')`);
    const combined = await exported('Test Exports/Combined/');
    assert.equal(combined.length, 1); assert.equal(combined[0][0], 'Test Exports/Combined/Selected.md');
    assert.ok(combined[0][1].includes('First **comment**') && combined[0][1].includes('Second comment') && !combined[0][1].includes('Third comment'), 'Selected pages export hidden comments once and keep the selection captured when opening the dialog');
    assert.ok(combined[0][1].includes('Document **notes**') && combined[0][1].includes('First quote'));
    assert.equal(await evaluate(`storage.get(view.file.path+'.obsidian-annot.json')`), await evaluate('exportSource'), 'Export never rewrites the source sidecar');
    await evaluate(`view.selectedNodes=new Set(['p:1','a:export-a'])`); await open();
    await set('.pdfaw-export-folder', 'Test Exports/Combined'); await set('.pdfaw-export-name', 'Selected');
    await submit(); await until(`!document.querySelector('.pdfaw-export-modal')`);
    assert.equal((await exported('Test Exports/Combined/')).length, 2, 'Repeated exports preserve the existing Markdown file');
    assert.equal((await exported('Test Exports/Combined/'))[0][1], combined[0][1]);
    await evaluate(`view.selectedNodes=new Set(['g:export-group','a:export-a'])`); await open();
    assert.match(await evaluate(`document.querySelector('.pdfaw-export-summary').textContent`), /^3 comments from 2 pages/);
    await set('.pdfaw-export-format', 'individual'); await set('.pdfaw-export-folder', 'Test Exports/Retry');
    await evaluate(`document.querySelector('.pdfaw-export-notes').checked=true;window.failExportAfter=1`);
    await submit(); await until(`document.querySelector('.pdfaw-export-error')?.textContent.includes('Export disk unavailable')`);
    assert.match(await evaluate(`document.querySelector('.pdfaw-export-status').textContent`), /1 of 4 files exported/);
    assert.equal(await evaluate(`document.querySelector('.pdfaw-export-format').disabled`), true, 'Partial retries keep the original export plan');
    await evaluate('window.failExportAfter=undefined'); await submit(); await until(`!document.querySelector('.pdfaw-export-modal')`);
    const individual = await exported('Test Exports/Retry/');
    assert.equal(individual.length, 4, 'A retry creates only remaining comments and one document-notes file');
    assert.ok(individual.some(([path]) => path.endsWith('Same title (2).md')));
    assert.equal(individual.filter(([, text]) => text.includes('First **comment**')).length, 1);
    assert.equal(individual.filter(([, text]) => text.includes('Document **notes**')).length, 1);
    const count = await evaluate('storage.size');
    await open(); await set('.pdfaw-export-folder', '../outside'); await submit();
    await until(`document.querySelector('.pdfaw-export-error')?.textContent.includes('folder inside the vault')`);
    assert.equal(await evaluate('storage.size'), count, 'Invalid paths create no Markdown files');
    await evaluate(`document.querySelector('.pdfaw-export-modal .pdfaw-modal-actions button').click()`);
    await open(); await evaluate(`document.querySelector('.pdfaw-export-modal .pdfaw-modal-actions button').click()`);
    assert.equal(await evaluate('storage.size'), count, 'Cancel creates no files');
    await evaluate(`view.selectedNodes=new Set(['a:export-c']);view.filter=null;view.renderAnnotations()`);
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await cdp('Emulation.setTouchEmulationEnabled', { enabled: true });
    await open(); await set('.pdfaw-export-folder', 'Test Exports/Mobile'); await set('.pdfaw-export-format', 'individual');
    assert.ok(await evaluate(`(() => {const r=document.querySelector('.pdfaw-export-modal').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight;})()`), 'Export fits a narrow touchscreen');
    const screenshot = await cdp('Page.captureScreenshot', { format: 'png' });
    await writeFile(new URL('../.test-artifacts/export-mobile.png', import.meta.url), Buffer.from(screenshot.data, 'base64'));
    const point = await evaluate(`(() => {const r=document.querySelector('.pdfaw-export-modal .mod-cta').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,id:1};})()`);
    await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await until(`!document.querySelector('.pdfaw-export-modal')`);
    const single = await exported('Test Exports/Mobile/'); assert.equal(single.length, 1); assert.ok(single[0][1].includes('Third comment'));
    assert.ok(!single[0][1].includes('Document **notes**'), 'Document notes are opt-in');
    await evaluate(`document.querySelector('button[aria-label="Canvas actions"]').click();lastMenu.items.find(item=>item.text==='Select all pages and comments').action()`);
    await open();
    assert.match(await evaluate(`document.querySelector('.pdfaw-export-summary').textContent`), /^3 comments from 2 pages/);
    await evaluate(`document.querySelector('.pdfaw-export-modal .pdfaw-modal-actions button').click()`);
    assert.equal(await evaluate(`storage.get(view.file.path+'.obsidian-annot.json')`), await evaluate('exportSource'), 'All export variants preserve the original annotations and notes');
    console.log('PASS: export dialog, individual/page/group/all selection, hidden comments, snapshot, both Markdown modes, notes, collisions, invalid paths, partial-write retry, cancellation and touchscreen export');
  } finally {
    await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1672, height: 941, deviceScaleFactor: 1, mobile: false });
    await evaluate(`(async()=>{window.failExportAfter=undefined;view.filter=null;view.sidecar=window.beforeExport;view.renderAnnotations();await view.save();await view.onLoadFile(new TFile('Forschungspapier.pdf'));})()`);
  }
}
