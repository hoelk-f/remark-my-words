import RemarkMyWordsPlugin, { PdfAnnotatorView } from '../src/main.ts';
import { TFile } from './obsidian-mock.mjs';
const storage = new Map();
const files = new Map();
const sideLeaves = [];
function sidebarLeaf() {
  const leaf = { app, contentEl: document.body.createDiv({cls:'test-sidebar', attr:{style:'position:fixed;right:0;top:0;width:300px;height:100%;overflow:auto;z-index:50;display:none'}}), view: {getViewType:()=> 'empty'},
    setViewState: async state => { leaf.view = window.plugin.factories.get(state.type)(leaf); await leaf.view.onOpen(); },
  };
  sideLeaves.push(leaf); return leaf;
}
const app = { vault: {
  configDir: '.obsidian',
  getFiles: () => [new TFile('Forschungspapier.pdf'), new TFile('note.md')],
  getName: () => 'Test vault',
  getAbstractFileByPath: path => files.get(path),
  read: async file => storage.get(file.path),
  readBinary: async file => (await fetch(file.path==='Long.pdf'?'/long-fixture.pdf':file.path==='Complex.pdf'?'/complex-fixture.pdf':'/fixture.pdf')).arrayBuffer(),
  create: async (path, data) => { storage.set(path, data); const file=new TFile(path);files.set(path, file);return file; },
  modify: async (file, data) => { storage.set(file.path, data); },
  process: async (file, fn) => { const data=fn(storage.get(file.path));storage.set(file.path,data);return data; },
}, workspace: { getActiveFile: () => window.activeFile ?? null, getLeaf: () => ({setViewState: async state => { window.openedState = state; }}), on: () => ({}),
  getLeavesOfType: type => sideLeaves.filter(leaf=>leaf.view.getViewType()===type), getRightLeaf: sidebarLeaf, getLeftLeaf: sidebarLeaf,
  revealLeaf: async leaf => { if(leaf.contentEl)leaf.contentEl.style.display='block'; },
  getActiveViewOfType: type => window.view instanceof type ? window.view : null,
  getMostRecentLeaf: () => leaf,
  setActiveLeaf: () => {}, onLayoutReady: () => {},
} };
const leaf = { app, setViewState: () => {} };
window.plugin = new RemarkMyWordsPlugin(app);
await window.plugin.onload();
window.view = window.plugin.viewFactory(leaf);
window.categories = window.plugin.categories;
window.reloadCategories = async () => { const plugin = new RemarkMyWordsPlugin(app); await plugin.onload(); return plugin.categories.all(); };
window.storage = storage; window.files = files; window.TFile = TFile;
await window.view.onOpen();
await window.view.onLoadFile(new TFile('Forschungspapier.pdf'));
window.ready = true;
