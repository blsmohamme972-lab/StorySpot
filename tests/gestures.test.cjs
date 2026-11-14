/* Gesture regressions use images/MCQ text fixtures, no lesson media. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../web');
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+(req.url==='/'?'/index.html':req.url.split('?')[0]));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(data);});
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/drive-sync.js',r=>r.fulfill({contentType:'text/javascript',body:'window.StorySpotSync={init:c=>c,useCatalog(){},sync:async()=>{}};'}));
  await page.addInitScript(()=>{window.StorySpotNative={ready(){},getItem:()=>'',setItem(){},setPlaybackActive(){},stopMcq(){},speakMcq(id){window.onMCQSpeech?.({id,state:'start'});}};});
  const index=()=>page.evaluate(()=>StorySpot.state.index);
  const touch=async(type,points,changed=points,target='#viewer')=>page.locator(target).evaluate((node,{type,points,changed})=>{
    const make=p=>new Touch({identifier:p.id,target:node,clientX:p.x,clientY:p.y});
    node.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,touches:points.map(make),targetTouches:points.map(make),changedTouches:changed.map(make)}));
  },{type,points,changed});
  const swipe=async(x1,y1,x2,y2,target='#viewer')=>{await touch('touchstart',[{id:1,x:x1,y:y1}],undefined,target);await touch('touchend',[],[{id:1,x:x2,y:y2}],target);};
  const wheel=async(deltaY,extras={},target='#viewer')=>page.locator(target).dispatchEvent('wheel',{deltaY,bubbles:true,cancelable:true,...extras});
  try{
    await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.StorySpot?.state.booted);
    await page.evaluate(()=>{
      const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="gray"/></svg>');
      const mcq={stem:'A long question. '.repeat(15),key:'A',explanation:'A supplied rationale. '.repeat(12),options:['A','B','C','D'].map(label=>({label,text:('Option '+label+' text. ').repeat(12),explanation:'A supplied rationale.'}))};
      StorySpot.loadCatalog({stories:Array.from({length:4},(_,i)=>({id:'gesture-'+i,title:'Story '+i,image,storyText:'Fixture transcript.',mcq}))});
    });
    await swipe(150,450,155,330);assert.equal(await index(),1,'Up selects exactly one next story');
    await swipe(150,330,150,450);assert.equal(await index(),0,'Down selects previous story');
    await swipe(50,450,220,380);assert.equal(await index(),0,'Horizontal/diagonal drags do not navigate');
    await swipe(150,450,150,420);assert.equal(await index(),0,'Small movement remains a tap');
    await touch('touchstart',[{id:1,x:150,y:450}]);await touch('touchcancel',[],[{id:1,x:150,y:440}]);await touch('touchend',[],[{id:1,x:150,y:300}]);assert.equal(await index(),0,'Cancelled touches cannot leave a swipe armed');
    await touch('touchstart',[{id:1,x:150,y:450}]);await touch('touchstart',[{id:1,x:150,y:450},{id:2,x:190,y:440}]);await touch('touchend',[],[{id:1,x:150,y:300},{id:2,x:190,y:300}]);assert.equal(await index(),0,'Multi-finger gestures do not navigate');
    await touch('touchstart',[{id:1,x:150,y:450}]);await touch('touchend',[],[{id:2,x:150,y:300}]);assert.equal(await index(),0,'A different finger cannot finish an old gesture');
    await touch('touchstart',[{id:1,x:150,y:450}]);await touch('touchstart',[{id:2,x:300,y:450}],undefined,'#saveButton');await touch('touchend',[],[{id:2,x:300,y:300}],'#saveButton');assert.equal(await index(),0,'Controls reject and reset pending gestures');
    await touch('touchstart',[{id:1,x:150,y:450}]);await page.evaluate(()=>StorySpot.selectTrack('explanation'));await touch('touchend',[],[{id:1,x:150,y:300}]);assert.equal(await index(),0,'A track change invalidates an unfinished swipe');
    await wheel(20);await wheel(20);assert.equal(await index(),0);await wheel(20);assert.equal(await index(),1,'Small trackpad events accumulate');
    for(let i=0;i<7;i++){await page.waitForTimeout(85);await wheel(100);}
    assert.equal(await index(),1,'A long inertial wheel burst navigates only once');
    await page.waitForTimeout(200);await wheel(-4,{deltaMode:1});assert.equal(await index(),0,'Line wheel units are normalized');
    await page.waitForTimeout(200);await wheel(100,{deltaX:180});await wheel(100,{ctrlKey:true});await wheel(100,{},'#saveButton');assert.equal(await index(),0,'Horizontal, zoom and control wheel gestures do not navigate');
    await page.locator('#nextButton').focus();await page.keyboard.press('Space');assert.equal(await index(),1,'Space on a button activates it once');
    await page.keyboard.press('ArrowDown');assert.equal(await index(),1,'Button keyboard input stays with the control');
    await page.locator('#viewer').focus();await page.keyboard.press('ArrowDown');assert.equal(await index(),2,'Viewer arrow navigation remains available');
    await page.locator('#viewer').dispatchEvent('keydown',{key:'ArrowDown',repeat:true,bubbles:true});assert.equal(await index(),2,'Held navigation key does not skip a burst of stories');
    await page.locator('#libraryButton').click();await page.keyboard.press('ArrowDown');assert.equal(await index(),2,'Open dialogs isolate feed navigation');await page.locator('[data-close="libraryDialog"]').click();
    await page.evaluate(()=>StorySpot.selectTrack('mcq'));
    assert.equal(await page.locator('#viewer').evaluate(e=>getComputedStyle(e).touchAction),'pan-y','MCQ ancestor permits vertical scrolling');
    const box=await page.locator('#mcqContent').boundingBox(),cdp=await page.context().newCDPSession(page);
    const x=box.x+box.width/2,y=box.y+box.height-30;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*(box.height-60)/8}]});await page.waitForTimeout(20);}
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    assert.ok(await page.locator('#mcqContent').evaluate(e=>e.scrollTop>0),'A real touchscreen gesture scrolls the MCQ text');
    assert.equal(await index(),2,'Scrolling a question never changes stories');
    await wheel(120,{},'#mcqContent');assert.equal(await index(),2,'Question wheel scrolling stays within MCQ');
    const pageY=await page.evaluate(()=>scrollY);await page.evaluate(()=>{StorySpot.togglePlay();StorySpotMCQ.seek(3);});
    assert.equal(await page.evaluate(()=>scrollY),pageY,'Narration highlight scrolls only the MCQ container');
    // Rotation must not strand the transport below the viewport. This uses
    // hit testing as well as bounds so overlapping controls are caught.
    const sourceCatalog=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../production/remote-library/catalog-source.json'),'utf8'));
    const longestQuote=sourceCatalog.stories.map(s=>s.quote?.text||'').sort((a,b)=>b.length-a.length)[0];
    for(const [width,height] of [[360,560],[360,600],[390,700],[320,568],[360,640],[390,844],[844,390],[640,360]]){
      await page.setViewportSize({width,height});
      for(const track of ['story','mcq']){
        await page.evaluate(track=>{StorySpot.stop();StorySpot.selectTrack(track);window.scrollTo(0,0);},track);
        const obscured=await page.evaluate(()=>[...document.querySelectorAll('#app button,#seek')].filter(e=>e.getClientRects().length).filter(e=>{
          const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
          return r.x<0||r.y<0||r.right>innerWidth||r.bottom>innerHeight||!hit||!(hit===e||e.contains(hit));
        }).map(e=>e.id));
        assert.deepEqual(obscured,[],`${width}x${height} ${track}: every visible control is reachable`);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No horizontal overflow after rotation');
      }
      const quoteFits=await page.evaluate(text=>{
        StorySpot.selectTrack('story');StorySpotQuotes.load({quote:{text,start:0,end:10}});StorySpotQuotes.showAt(1,true);
        const overlay=document.getElementById('quoteOverlay'),quote=document.getElementById('quoteText');
        const a=overlay.getBoundingClientRect(),b=quote.getBoundingClientRect();
        return b.top>=a.top&&b.bottom<=a.bottom&&overlay.scrollHeight<=overlay.clientHeight+1;
      },longestQuote);
      assert.equal(quoteFits,true,`${width}x${height}: the longest existing Arabic quote fits`);
      await page.evaluate(()=>StorySpotQuotes.stop());
    }
    // Use the supplied story text and titles to exercise long portrait sheets,
    // repeated only as a long-text fixture, independent of optional media files.
    await page.evaluate(stories=>{
      const image=StorySpot.state.stories[0].image;
      StorySpot.loadCatalog({stories:stories.map(s=>({...s,image,storyAudio:'',explanationAudio:'',storyText:s.storyText.repeat(3)}))});
    },sourceCatalog.stories);
    for(const [width,height] of [[360,560],[360,600],[390,700],[320,568]]){
      await page.setViewportSize({width,height});
      await page.locator('#libraryButton').click();
      assert.equal(await page.locator('#libraryDialog').evaluate(e=>e.scrollWidth<=e.clientWidth),true,'Portrait library never overflows horizontally');
      await page.locator('#addBookButton').click();
      await page.locator('#bookName').fill('A separately connected book');
      await page.locator('#bookFolder').fill('https://drive.google.com/drive/folders/example-folder');
      await page.locator('#bookFolder').scrollIntoViewIfNeeded();
      assert.equal(await page.locator('#bookFolder').evaluate(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight&&hit===e;}),true,'Book folder field stays reachable inside the sheet');
      await page.locator('#cancelBook').click();
      assert.equal(await page.locator('#bookForm').isHidden(),true,'Cancel closes only the book form');
      const lastId=await page.locator('#libraryList .library-item').last().locator('b').textContent();
      await page.locator('#libraryList .library-item').last().click();
      assert.equal(await page.locator('#libraryDialog').isVisible(),false,'A scrolled library row is selectable');
      assert.equal(await page.locator('#storyTitle').textContent(),lastId);
      await page.locator('#transcriptButton').click();
      assert.equal(await page.locator('#transcriptBody').getAttribute('dir'),'rtl');
      const dialog=page.locator('#transcriptDialog'),bounds=await dialog.boundingBox();
      assert.ok(await dialog.evaluate(e=>e.scrollHeight>e.clientHeight),'Existing Arabic story needs a scrollable transcript');
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:width/2,y:bounds.y+bounds.height-40}]});
      for(let i=1;i<=8;i++){
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:width/2,y:bounds.y+bounds.height-40-i*(bounds.height-150)/8}]});
        await page.waitForTimeout(15);
      }
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      assert.ok(await dialog.evaluate(e=>e.scrollTop>0),'A touchscreen gesture scrolls the transcript');
      assert.equal(await page.evaluate(()=>scrollY),0,'Modal scrolling leaves the background player in place');
      const reachesEnd=await dialog.evaluate(e=>{
        e.scrollTop=e.scrollHeight;
        const text=document.getElementById('transcriptBody').firstChild,range=document.createRange();
        range.setStart(text,Math.max(0,text.length-20));range.setEnd(text,text.length);
        const last=range.getBoundingClientRect(),sheet=e.getBoundingClientRect();
        return last.top>=sheet.top&&last.bottom<=sheet.bottom;
      });
      assert.equal(reachesEnd,true,'The end of the Arabic transcript is reachable');
      await page.locator('[data-close="transcriptDialog"]').click();
      assert.equal(await dialog.isVisible(),false,'Transcript close remains reachable after scrolling');
    }
    assert.deepEqual(errors,[]);
    console.log('Gesture/layout regressions passed: axis filtering, cancellation, multitouch, controls, keyboard, wheel inertia, MCQ touchscreen scrolling, compact portrait viewports, book forms and transcript scrolling, rotated transport and Arabic quote bounds.');
  }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
