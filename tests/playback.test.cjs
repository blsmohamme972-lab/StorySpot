/* Player regression with silent generated test WAV; no production narration or media. */
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
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/drive-sync.js',route=>route.fulfill({contentType:'text/javascript',body:'window.StorySpotSync={init:c=>c,useCatalog(){},sync:async()=>{}};'}));
  // Isolate controller/host integration from the speech implementation tests.
  await page.route('**/mcq.js',route=>route.fulfill({contentType:'text/javascript',body:`
    let step=0;window.__mcq={loads:0,rate:1,muted:false};
    const emit=playing=>dispatchEvent(new CustomEvent('storyspot:mcqstate',{detail:{playing,segmentIndex:step}}));
    window.StorySpotMCQ={load(){__mcq.loads++;step=0;},hasContent:()=>true,currentTime:()=>step,duration:()=>4,play:()=>emit(true),pause:()=>emit(false),stop:()=>emit(false),seek(n){step=n;emit(false);},setRate(n){__mcq.rate=n;},setMuted(n){__mcq.muted=n;}};` }));
  await page.route('**/quotes.js',route=>route.fulfill({contentType:'text/javascript',body:`
    let quote=null,visible=false;window.StorySpotQuotes={load(story){quote=story?.quote;this.stop();},hasQuote:()=>!!quote,
    get isPlaying(){return visible;},showAt(time,enabled){visible=!!enabled&&!!quote&&time>=quote.start&&time<quote.end;document.getElementById('quoteOverlay').hidden=!visible;},
    stop(){visible=false;document.getElementById('quoteOverlay').hidden=true;}};` }));
  await page.addInitScript(()=>{window.__focus=[];window.StorySpotNative={ready(){},setPlaybackActive:active=>__focus.push(active),getItem:()=>'',setItem(){}};});
  try {
    console.log('loading');await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.StorySpot?.state.booted);
    console.log('fixtures');await page.evaluate(()=>{
      const samples=8000*12,bytes=new ArrayBuffer(44+samples*2),view=new DataView(bytes);
      const str=(at,s)=>{for(let i=0;i<s.length;i++)view.setUint8(at+i,s.charCodeAt(i));};
      str(0,'RIFF');view.setUint32(4,36+samples*2,true);str(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,8000,true);view.setUint32(28,16000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);str(36,'data');view.setUint32(40,samples*2,true);
      const audio=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));
      window.__fixture={id:'regression-1',title:'Fixture',image:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="gray"/></svg>'),storyAudio:audio,explanationAudio:audio,cues:[{time:2,x:.2,y:.3,zoom:3,label:'first'},{time:4,endTime:5,x:.8,y:.7,zoom:4,label:'second'}]};
      StorySpot.loadCatalog({stories:[__fixture]});
    });
    await page.waitForFunction(()=>document.getElementById('storyImage').naturalWidth>0&&document.getElementById('audio').readyState>=2);
    assert.equal(await page.evaluate(()=>StorySpot.focusAt(1.99).pointer),false,'No cue appears before its timestamp');
    assert.equal(await page.evaluate(()=>StorySpot.focusAt(3.99).x),.2,'Next cue is not anticipated');
    assert.equal(await page.evaluate(()=>StorySpot.focusAt(4).x),.8,'Cue activates at spoken boundary');
    assert.equal(await page.evaluate(()=>StorySpot.focusAt(5).pointer),false,'Cue ends at explicit endTime');
    await page.evaluate(()=>StorySpot.seek(4.1));
    assert.match(await page.locator('#scene').evaluate(el=>el.style.transform),/^matrix\(1, 0, 0, 1,/,'Camera never zooms');
    assert.equal(await page.locator('#pointer').evaluate(el=>el.hidden),false);
    console.log('playing');await page.evaluate(()=>StorySpot.seek(1));await page.evaluate(()=>StorySpot.togglePlay());
    await page.waitForFunction(()=>StorySpot.state.playing);
    const before=await page.locator('#audio').evaluate(el=>el.currentTime);
    await page.evaluate(()=>StorySpot.loadCatalog({stories:[{...__fixture,title:'Changed during playback'}]}));
    assert.equal(await page.locator('#storyTitle').textContent(),'Fixture','Changed catalog is deferred during playback');
    assert.equal(await page.locator('#audio').evaluate(el=>el.paused),false,'Catalog change must not interrupt voice');
    assert.ok((await page.locator('#audio').evaluate(el=>el.currentTime))>=before);
    await page.evaluate(()=>{const a=document.getElementById('audio');a.dispatchEvent(new Event('waiting'));});
    assert.equal(await page.evaluate(()=>StorySpot.state.playIntent),true,'Buffering retains play intent');
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
    assert.equal(await page.locator('#audio').evaluate(el=>el.paused),false,'Transient hidden event does not pause media');
    await page.evaluate(()=>dispatchEvent(new Event('storyspot:pause')));
    assert.equal(await page.locator('#audio').evaluate(el=>el.paused),true,'Native explicit interruption pauses');
    assert.equal(await page.evaluate(()=>StorySpot.state.playIntent),false);
    console.log('quote');
    // The quote follows the recorded STORY timeline; explanation has no prelude.
    await page.evaluate(()=>{__fixture.quote={text:'A supplied quote',start:1,end:2};StorySpot.loadCatalog({stories:[__fixture]});StorySpot.seek(1.2);StorySpot.togglePlay();});
    await page.waitForFunction(()=>StorySpotQuotes.isPlaying);
    assert.equal(await page.locator('#quoteOverlay').evaluate(el=>el.hidden),false);
    await page.evaluate(()=>StorySpot.togglePlay());
    assert.equal(await page.locator('#quoteOverlay').evaluate(el=>el.hidden),true,'Pause hides the quote');
    await page.evaluate(()=>{StorySpot.selectTrack('explanation');StorySpot.togglePlay();});
    await page.waitForFunction(()=>!document.getElementById('audio').paused);
    assert.equal(await page.locator('#quoteOverlay').evaluate(el=>el.hidden),true,'English explanation has no quote prelude');
    // Verify MCQ tab shares controls and range describes steps instead of seconds.
    await page.evaluate(()=>{StorySpot.stop();StorySpot.selectTrack('mcq');});
    assert.equal(await page.locator('#seek').getAttribute('step'),'1');
    assert.equal(await page.locator('#duration').textContent(),'4');
    await page.evaluate(()=>StorySpot.togglePlay());
    assert.equal(await page.evaluate(()=>StorySpot.state.playing),true);
    await page.evaluate(()=>StorySpot.seek(2));
    assert.equal(await page.locator('#elapsed').textContent(),'Step 3');
    assert.equal(await page.locator('#pointer').evaluate(el=>el.hidden),true,'MCQ owns text focus, not image spotlight');
    await page.locator('#speedButton').click();assert.equal(await page.evaluate(()=>__mcq.rate),1.25);
    await page.locator('#soundButton').evaluate(el=>el.click());assert.equal(await page.evaluate(()=>__mcq.muted),true);
    assert.deepEqual(errors,[]);
    console.log('Playback regressions passed: cue boundaries, static image, refresh continuity, buffering, lifecycle, recorded story quote timing, MCQ controls.');
  } finally {await browser.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
