import assert from 'node:assert/strict';

/** Browser-level touch input also exercises native scrolling/pointercancel. */
export async function testTouch({ evaluate, until, cdp }) {
  let touching = false;
  const send = async (type, touchPoints = []) => {
    await cdp('Input.dispatchTouchEvent', { type, touchPoints });
    if (type === 'touchStart') touching = true;
    if (type === 'touchCancel' || (type === 'touchEnd' && !touchPoints.length)) touching = false;
  };
  const settled = () => until('view.pageReady && view.rasterTimer === undefined && view.pageTask === null');
  const zoom = () => evaluate('view.camera.zoom');
  const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 0.02, `${label}: ${actual} vs ${expected}`);
  const annotations = await evaluate('JSON.stringify(view.sidecar.annotations)');
  const savedMode = await evaluate('view.mode');
  const hiddenPages = await evaluate('view.root.hasClass("pdfaw-hide-pages")');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  try {
    await evaluate('view.root.addClass("pdfaw-hide-pages")');
    for (const mode of ['canvas', 'reading']) {
      await evaluate(`view.setMode('${mode}');view.setTool('select');view.zoomBy(1/view.camera.zoom);
        view.camera.x=-180;view.camera.y=-180;view.applyCamera();view.viewport.scrollTo(${mode === 'reading' ? '180,180' : '0,0'});
        window.touchTextLayer=view.pageEl.querySelector('.pdfaw-textlayer')`);
      await settled();
      const center = await evaluate('(() => {const r=view.viewport.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+240};})()');
      const points = (half, dx=0, dy=0) => [
        {x:center.x+dx-half,y:center.y+dy,id:1}, {x:center.x+dx+half,y:center.y+dy,id:2},
      ];
      const anchor = await evaluate(`(() => {const r=view.pageEl.getBoundingClientRect();return {x:(${center.x}-r.x)/view.camera.zoom,y:(${center.y}-r.y)/view.camera.zoom};})()`);
      await send('touchStart',points(40));
      await send('touchMove',points(80,10,20));
      near(await zoom(),2,`${mode}: spreading fingers doubles zoom`);
      const anchored = await evaluate(`(() => {const r=view.pageEl.getBoundingClientRect();return {x:r.x+${anchor.x}*view.camera.zoom,y:r.y+${anchor.y}*view.camera.zoom};})()`);
      assert.ok(Math.abs(anchored.x-center.x-10)<=2 && Math.abs(anchored.y-center.y-20)<=2,`${mode}: PDF point follows finger midpoint: ${JSON.stringify({anchored,center})}`);
      for (const [half,expected] of [[20,0.5],[240,3],[1,0.1],[40,1]]) {
        await send('touchMove',points(half));
        near(await zoom(),expected,`${mode}: zoom out, limits and recovery`);
      }
      assert.equal(await evaluate('visualViewport.scale'),1,'Only the PDF zooms, not the host UI');
      assert.equal(await evaluate('view.pageEl.querySelector(".pdfaw-textlayer")===touchTextLayer'),true,'Keep the text layer');
      assert.equal(await evaluate('view.selection'),null,'Pinching leaves no text selection');
      assert.equal(await evaluate('view.commentPreview.el.hidden'),true,'Pinching does not open a comment');
      // One remaining finger must not revive a stale pan/selection.
      await send('touchEnd',[points(40)[0]]);
      const beforeRemaining = await evaluate('JSON.stringify({camera:view.camera,left:view.viewport.scrollLeft,top:view.viewport.scrollTop})');
      await send('touchMove',[{...points(40)[1],y:center.y+70}]);
      assert.equal(await evaluate('JSON.stringify({camera:view.camera,left:view.viewport.scrollLeft,top:view.viewport.scrollTop})'),beforeRemaining);
      await send('touchEnd');
      assert.equal(await evaluate('view.pinchActive'),false);
      await settled();
      // Cancellation must allow the next gesture to start normally.
      await send('touchStart',points(40));
      await send('touchMove',points(60));
      await send('touchCancel');
      assert.equal(await evaluate('view.pinchActive'),false);
      await send('touchStart',points(40));
      await send('touchMove',points(60));
      await send('touchEnd');
      near(await zoom(),2.25,`${mode}: new pinch after cancellation`);
      // Ignore a third finger, then rebase if it replaces one of the pair.
      await evaluate('view.zoomBy(1/view.camera.zoom)');
      await send('touchStart',points(40));
      const third={x:center.x,y:center.y+100,id:3};
      await send('touchStart',[...points(40),third]);
      await send('touchMove',[...points(60),third]);
      near(await zoom(),1.5,`${mode}: third finger does not change the pair`);
      await send('touchEnd',[points(60)[0]]);
      await send('touchMove',[{...points(60)[1],x:center.x+90},{...third,y:center.y+150}]);
      near(await zoom(),2.25,`${mode}: replaced finger rebases without a jump`);
      await send('touchEnd');
      await settled();
    }
    await evaluate('view.setMode("reading");view.zoomBy(1/view.camera.zoom);view.viewport.scrollTo(0,0)');
    await settled();
    const box=await evaluate('(() => {const r=view.viewport.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+350};})()');
    await send('touchStart',[{...box,id:1}]);
    for(let i=1;i<=10;i++) {
      await send('touchMove',[{x:box.x,y:box.y-i*18,id:1}]);
      await evaluate('new Promise(resolve=>requestAnimationFrame(resolve))');
    }
    await send('touchEnd');
    await until('view.viewport.scrollTop>0');
    near(await zoom(),1,'One-finger reading scroll does not zoom');
    await evaluate('view.setMode("canvas");view.setTool("hand")');
    const beforePan=await evaluate('view.camera.y');
    await send('touchStart',[{...box,id:1}]);
    await send('touchMove',[{x:box.x,y:box.y+60,id:1}]);
    await send('touchEnd');
    near(await evaluate('view.camera.y')-beforePan,60,'One-finger hand pan still works');
    // Navigation must discard an active pinch.
    const pair=[{x:box.x-30,y:box.y,id:1},{x:box.x+30,y:box.y,id:2}];
    await send('touchStart',pair);
    await evaluate('view.setMode("reading")');
    assert.equal(await evaluate('view.pinchActive'),false);
    await send('touchEnd');
    await send('touchStart',pair);
    await evaluate('view.showPage(2)');
    assert.equal(await evaluate('view.pinchActive'),false);
    await send('touchEnd');
    await evaluate('view.showPage(1)');
    assert.equal(await evaluate('JSON.stringify(view.sidecar.annotations)'),annotations,'Touch navigation never edits annotations');
    console.log('PASS: pinch zoom in both modes, moving anchor, limits, remaining/third fingers, cancellation, native scroll and hand pan');
  } finally {
    if (touching) await send('touchCancel');
    await cdp('Emulation.setTouchEmulationEnabled',{enabled:false});
    await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:941,deviceScaleFactor:1,mobile:false});
    await evaluate(`view.root.toggleClass('pdfaw-hide-pages',${hiddenPages});view.setMode('${savedMode}');view.setTool('select');view.fit()`);
    await settled();
  }
}
