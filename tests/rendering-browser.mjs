import assert from 'node:assert/strict';

export async function testRendering({ evaluate, until, cdp }) {
  const settled = () => until('view.pageReady && view.rasterFrame === 0 && view.rasterTimer === undefined && view.pageTask === null && view.rasterDensity === view.requestedDensity');
  for (const mode of ['canvas', 'reading']) {
    await evaluate(`view.setMode('${mode}')`);
    await settled();
    await evaluate(`(() => {
      window.originalLayer = view.pageEl.querySelector('.pdfaw-textlayer');
      const span = originalLayer.querySelector('span'), range = document.createRange();
      range.selectNodeContents(span); getSelection().removeAllRanges(); getSelection().addRange(range);
      view.captureSelection(); window.selectedText = getSelection().toString();
      window.savedQuads = JSON.stringify(view.sidecar.annotations.map(a => a.quads));
    })()`);
    for (const [zoom, density] of [[0.65, 1], [1.15, 1.25], [1.6, 2.5]]) {
      await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 941, deviceScaleFactor: density, mobile: false });
      await evaluate(`view.zoomBy(${zoom} / view.camera.zoom)`);
      await settled();
      const raster = await evaluate(`(() => {
        const canvas = view.pageEl.querySelector('canvas'), rect = canvas.getBoundingClientRect();
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        return { width: canvas.width, height: canvas.height, displayedWidth: rect.width * devicePixelRatio,
          displayedHeight: rect.height * devicePixelRatio, hasInk: pixels.some((value, index) => index % 4 === 0 && value < 100) };
      })()`);
      assert.ok(Math.abs(raster.width - raster.displayedWidth) <= 1.1, `${mode}: bitmap matches physical width at ${zoom}x / DPR ${density}`);
      assert.ok(Math.abs(raster.height - raster.displayedHeight) <= 1.1, `${mode}: bitmap matches physical height at ${zoom}x / DPR ${density}`);
      assert.ok(raster.hasInk, 'The replacement canvas contains the PDF text');
      assert.equal(await evaluate('view.pageEl.querySelector(".pdfaw-textlayer") === originalLayer'), true, 'Resolution updates retain the text layer');
      assert.equal(await evaluate('getSelection().toString() === selectedText'), true, 'Resolution updates retain native selection');
      assert.equal(await evaluate('JSON.stringify(view.sidecar.annotations.map(a => a.quads)) === savedQuads'), true, 'Zoom does not change saved highlight coordinates');
    }
    await evaluate('getSelection().removeAllRanges();view.clearSelection()');
  }
  // A display-density change must refresh the bitmap even without changing zoom.
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 941, deviceScaleFactor: 1, mobile: false });
  await evaluate('dispatchEvent(new Event("resize"))');
  await settled();
  assert.ok(await evaluate('Math.abs(view.pageCanvas.width - view.pageCanvas.getBoundingClientRect().width) <= 1.1'));
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 941, deviceScaleFactor: 3, mobile: false });
  await evaluate('view.zoomBy(3 / view.camera.zoom)');
  await settled();
  assert.ok(await evaluate('view.pageCanvas.width * view.pageCanvas.height <= 16_790_000 && Math.max(view.pageCanvas.width, view.pageCanvas.height) <= 8192'), 'Extreme zoom respects the bitmap memory and dimension limits');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 941, deviceScaleFactor: 1, mobile: false });
  await evaluate('view.fit()');
  await settled();
  // Hold a real completed raster while navigating to catch a stale canvas swap.
  await evaluate(`(() => {
    window.heldPage = view.pages.surfaces.get(view.currentPage).page;
    window.originalRender = heldPage.render;
    window.rasterHeld = false;
    heldPage.render = function(...args) {
      const task = originalRender.apply(this, args);
      const promise = task.promise.then(async () => {
        if (!window.rasterHeld) { window.rasterHeld = true; await new Promise(resolve => { window.releaseRaster = resolve; }); }
      });
      return {promise, cancel:()=>task.cancel()};
    };
    window.visibleCanvas = view.pageCanvas;
    view.zoomBy(1.15);
  })()`);
  await until('window.rasterHeld');
  assert.equal(await evaluate('view.pageCanvas === visibleCanvas && visibleCanvas.isConnected'), true, 'The previous bitmap stays visible until the replacement is ready');
  await evaluate('view.showPage(2)');
  await evaluate('releaseRaster();heldPage.render = originalRender');
  await evaluate('new Promise(resolve => requestAnimationFrame(resolve))');
  assert.equal(await evaluate('view.pageCanvas.getAttribute("aria-label")'), 'PDF page 2', 'An old render cannot replace a newly opened page');
  await evaluate('view.viewport.scrollTop = view.viewport.scrollHeight;view.viewport.dispatchEvent(new WheelEvent("wheel",{deltaY:700,bubbles:true,cancelable:true}))');
  assert.equal(await evaluate('view.currentPage'), 2, 'Cannot scroll beyond the last page');
  await evaluate('view.viewport.scrollTop = 0;view.viewport.dispatchEvent(new WheelEvent("wheel",{deltaY:-700,bubbles:true,cancelable:true}))');
  await until('view.currentPage === 1 && view.pageReady');
  assert.ok(await evaluate('Math.abs(view.viewport.scrollTop + view.viewport.clientHeight - view.viewport.scrollHeight) <= 1'), 'Upward navigation restores the bottom after rendering');
  // At small zoom an entire page fits, so both edges are valid and must stay at zero.
  await cdp('Emulation.setDeviceMetricsOverride', { width: 320, height: 941, deviceScaleFactor: 1, mobile: false });
  await evaluate('view.fit()');
  await evaluate('view.viewport.dispatchEvent(new WheelEvent("wheel",{deltaY:700,bubbles:true,cancelable:true}))');
  await until('view.currentPage === 2 && view.pageReady');
  await evaluate('view.viewport.dispatchEvent(new WheelEvent("wheel",{deltaY:-700,bubbles:true,cancelable:true}))');
  await until('view.currentPage === 1 && view.pageReady');
  assert.equal(await evaluate('view.viewport.scrollTop'), 0, 'Short pages have no artificial bottom offset');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 941, deviceScaleFactor: 1, mobile: false });
  await evaluate('view.fit()');
  await settled();
  console.log('PASS: zoom and display-density rendering, bitmap limits, preserved selection and highlights, stale render cancellation and reading page boundaries');
}
