import assert from 'node:assert/strict';
export async function testPerformance({evaluate,until}, baseline=false) {
  const metrics=await evaluate(`(async()=>{
    view.setMode('canvas');
    const start=performance.now();await view.onLoadFile(new TFile('Long.pdf'));
    const loadMs=performance.now()-start;
    view.sidecar.annotations=Array.from({length:1200},(_,i)=>({id:'perf-'+i,page:1+Math.floor(i/10),text:'Benchmark passage',comment:'A longer benchmark comment. '.repeat(8),title:'Comment '+i,category:'note',color:'yellow',quads:[{x:50,y:100+(i%10)*30,w:90,h:20}],createdAt:1,updatedAt:1}));
    view.renderAnnotations();await view.showPage(1);
    await new Promise(r=>setTimeout(r,400));
    const originalRect=Element.prototype.getBoundingClientRect, originalLines=view.drawConnections;
    let pageMeasurements=0,lineRebuilds=0;
    Element.prototype.getBoundingClientRect=function(){if(this.classList.contains('pdfaw-page'))pageMeasurements++;return originalRect.call(this);};
    view.drawConnections=function(...args){lineRebuilds++;return originalLines.apply(this,args);};
    const samples=[];
    try {
      for(let i=0;i<30;i++) {const tick=performance.now();view.camera.x+=i%2?2:-2;view.applyCamera();await new Promise(r=>requestAnimationFrame(r));samples.push(performance.now()-tick);}
    } finally {Element.prototype.getBoundingClientRect=originalRect;view.drawConnections=originalLines;}
    samples.sort((a,b)=>a-b);
    return {loadMs:Math.round(loadMs),pageMeasurements,lineRebuilds,mountedCards:view.cards.size,panMedianMs:Math.round(samples[15]),panP95Ms:Math.round(samples[28])};
  })()`);
  console.log('PERFORMANCE '+(baseline?'BASELINE ':'')+JSON.stringify(metrics));
  if(!baseline) {
    assert.equal(metrics.pageMeasurements,0,'Panning never measures individual PDF page elements');
    assert.equal(metrics.lineRebuilds,0,'Panning within the same visible region never rebuilds connections');
    assert.ok(metrics.mountedCards<100,'Offscreen comments are virtualized');
  }
  if (!baseline) {
    // Deliberately stall page 2: the first page must still become usable, and
    // navigation to a distant page must bypass the metadata queue.
    await evaluate(`(() => {
      window.originalPrepare = view.pages.prepare;
      view.pages.prepare = async function(pdf) {
        const getPage = pdf.getPage.bind(pdf);
        const gate = new Promise(resolve=>{window.releaseMetadata=resolve});
        window.metadataWaiting=false;
        pdf.getPage = number => { if(number!==2)return getPage(number);window.metadataWaiting=true;return gate.then(()=>getPage(number)); };
        return originalPrepare.call(this,pdf);
      };
      window.startupReady=false;window.startupLoad=view.onLoadFile(new TFile('Long.pdf')).then(()=>{window.startupReady=true;});
    })()`);
    await until('startupReady && metadataWaiting');
    assert.equal(await evaluate('view.pageReady && view.currentPage===1'),true,'The first page is usable while later metadata is blocked');
    assert.equal(await evaluate('view.pages.surfaces.get(120).page'),null,'Startup does not wait for all page objects');
    assert.ok(await evaluate(`(() => {const r=view.pageEl.getBoundingClientRect(),v=view.viewport.getBoundingClientRect();return r.top>=v.top && r.bottom<=v.bottom && r.height>v.height*0.6;})()`),'Canvas opens with the first page fitted at a readable size');
    await evaluate(`window.oldNavigation=view.showPage(2);view.showPage(120)`);
    assert.equal(await evaluate('view.currentPage'),120,'Direct navigation bypasses stalled preparation');
    await evaluate(`view.setNodePosition('p:75',{x:2345,y:6789});window.manualPosition=structuredClone(view.layout.pages[75]);releaseMetadata();view.pages.metadataReady`);
    await evaluate('oldNavigation');
    await until('view.dimensionFrame===0 && view.rasterFrame===0');
    assert.equal(await evaluate('view.currentPage'),120,'An older navigation cannot replace the newest page');
    assert.deepEqual(await evaluate('view.layout.pages[75]'),await evaluate('manualPosition'),'Background dimension updates retain manual positions');
    await evaluate(`view.pages.prepare=originalPrepare;view.save()`);
    const saved=await evaluate('structuredClone(view.layout)');
    await evaluate('view.onLoadFile(new TFile("Long.pdf"))');
    await evaluate('view.pages.metadataReady');await until('view.dimensionFrame===0');
    assert.deepEqual(await evaluate('view.layout'),saved,'Saved layouts survive progressive preparation');
    // Returning to a recently viewed page should reuse its existing raster.
    await evaluate('view.showPage(1)');
    await until('view.rasterFrame===0 && view.rasterTimer===undefined && !view.pages.surfaces.get(1).pending');
    await evaluate('window.cachedCanvas=view.pages.surfaces.get(1).canvas');
    await evaluate('view.showPage(20)');await evaluate('view.showPage(1)');
    assert.equal(await evaluate('view.pages.surfaces.get(1).canvas===cachedCanvas'),true,'Back navigation reuses a cached page bitmap');
    for(const number of [20,40,60,80,100]) await evaluate('view.showPage('+number+')');
    await until('view.rasterFrame===0 && view.rasterTimer===undefined && [...view.pages.surfaces.values()].every(s=>!s.pending)');
    assert.ok(await evaluate('[...view.pages.surfaces.values()].filter(s=>!s.wanted && s.canvas).length<=3'),'At most three offscreen pages are cached');
    assert.ok(await evaluate('[...view.pages.surfaces.values()].filter(s=>!s.wanted).reduce((n,s)=>n+(s.canvas?s.canvas.width*s.canvas.height:0),0)<=8388608'),'Offscreen cache respects its pixel budget');
    await evaluate(`(async()=>{
      const original=view.pages.loadPage, surface=view.pages.surfaces.get(18), page=surface.page;surface.page=null;
      window.beforeFailedNavigation=view.currentPage;
      view.pages.loadPage=async number=>{if(number===18)throw new Error('Controlled failed page');return original.call(view.pages,number);};
      try {await view.showPage(18);} finally {view.pages.loadPage=original;surface.page=page;}
    })()`);
    assert.equal(await evaluate('view.currentPage'),await evaluate('beforeFailedNavigation'),'A page-load failure leaves the current page usable');
    assert.equal(await evaluate('view.pageReady'),true);
    await evaluate('view.showPage(18)');assert.equal(await evaluate('view.currentPage'),18,'Navigation works again after a page-load failure');
    await evaluate('view.onLoadFile(new TFile("Complex.pdf"))');
    await evaluate('view.pages.metadataReady');await until('view.dimensionFrame===0');
    assert.equal(await evaluate('view.pages.surfaces.size'),12);
    for(const number of [3,8,12,1]) {
      await evaluate('view.showPage('+number+')');
      await until('view.rasterFrame===0 && view.rasterTimer===undefined && [...view.pages.surfaces.values()].every(s=>!s.pending)');
      assert.ok(await evaluate(`(() => {const c=view.pageCanvas,d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return d.some((value,i)=>i%4===0&&value<180)})()`),'Image/vector pages render correctly');
      assert.ok(await evaluate('[...view.pages.surfaces.values()].reduce((n,s)=>n+(s.canvas?s.canvas.width*s.canvas.height:0),0)<34000000'),'Complex PDF respects the shared raster budget');
    }
    assert.ok(await evaluate('view.pages.surfaces.get(3).width>view.pages.surfaces.get(1).width'),'Landscape dimensions replace placeholders');
    await evaluate(`view.setMode('reading');view.showPage(12)`);
    await evaluate(`view.canvasCamera=null;view.setMode('canvas');view.pages.ensure(1)`);
    await until('view.currentPage===1 && view.pageReady');
    assert.ok(await evaluate('!!view.pages.surfaces.get(1).canvas && !!view.pages.surfaces.get(1).textLayer'),'First Canvas entry restores a usable first page after Reading a distant page');
    console.log('PASS: image/vector PDFs, mixed sizes, raster limits and first-page Canvas entry');
    console.log('PASS: early first-page display, blocked metadata, distant/concurrent navigation, saved/manual positions and bounded raster reuse');
  }
  await evaluate('view.onLoadFile(new TFile("Forschungspapier.pdf"))');
  await until('view.pageReady');
}
