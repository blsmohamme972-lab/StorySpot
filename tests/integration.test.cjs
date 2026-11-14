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
  await page.addInitScript(()=>{
    window.__speech=[];window.__focus=[];
    window.StorySpotNative={ready(){},getItem:()=>'',setItem(){},setPlaybackActive:active=>__focus.push(active),
      speakMcq(id,text,lang,rate){__speech.push({id,text,lang,rate});},stopMcq(){}};
  });
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
    // Actual MCQ controller: speech events alone advance the displayed focus.
    await page.evaluate(()=>StorySpot.selectTrack('mcq'));
    assert.equal(await page.locator('#playButton').isDisabled(),true,'MCQ unavailable before source data arrives');
    await page.evaluate(()=>{
      __fixture.mcq={stem:'Which shape has three sides?',key:'B',options:[{label:'A',text:'A circle',explanation:'A circle has no straight sides.'},{label:'B',text:'A triangle'},{label:'C',text:'A square',explanation:'A square has four sides.'}],explanation:'A triangle has three straight sides.'};
      StorySpot.loadCatalog({stories:[__fixture]});StorySpot.selectTrack('mcq');StorySpot.togglePlay();
    });
    assert.equal(await page.locator('#playButton').isDisabled(),false,'Same-media MCQ update enables playback without changing tabs');
    assert.equal(await page.evaluate(()=>__speech.at(-1).text),'Question. Which shape has three sides?');
    await page.evaluate(()=>onMCQSpeech({id:__speech.at(-1).id,state:'start'}));
    assert.equal(await page.locator('#mcqPhase').textContent(),'THE QUESTION');
    await page.evaluate(()=>{const id=__speech.at(-1).id;StorySpot.loadCatalog({stories:[__fixture]});if(__speech.at(-1).id!==id)throw new Error('Unchanged refresh interrupted MCQ speech');});
    await page.evaluate(()=>onMCQSpeech({id:__speech.at(-1).id,state:'done'}));
    assert.match(await page.evaluate(()=>__speech.at(-1).text),/^Correct answer\. Option B/);
    await page.evaluate(()=>onMCQSpeech({id:__speech.at(-1).id,state:'start'}));
    assert.equal(await page.locator('#mcqContent [data-option="B"]').getAttribute('aria-current'),'true');
    await page.screenshot({path:'/workspace/outputs/storyspot-mcq.png'});
    await page.evaluate(()=>onMCQSpeech({id:__speech.at(-1).id,state:'done'}));
    assert.match(await page.evaluate(()=>__speech.at(-1).text),/Incorrect option A.*no straight sides/);
    await page.evaluate(()=>onMCQSpeech({id:__speech.at(-1).id,state:'start'}));
    assert.equal(await page.locator('#mcqContent [data-option="A"]').getAttribute('aria-current'),'true');
    await page.evaluate(()=>{StorySpot.stop();__fixture.quote={text:'كل خطوة صغيرة تقربك من هدفك.',start:1,end:3};StorySpot.loadCatalog({stories:[__fixture]});StorySpot.selectTrack('story');StorySpot.seek(1.2);StorySpot.togglePlay();});
    await page.waitForFunction(()=>StorySpotQuotes.isPlaying);
    assert.equal(await page.locator('#quoteOverlay').evaluate(el=>el.hidden),false);
    await page.screenshot({path:'/workspace/outputs/storyspot-quote.png'});
    await page.evaluate(()=>StorySpot.seek(3.1));
    await page.waitForFunction(()=>!StorySpotQuotes.isPlaying);
    assert.equal(await page.locator('#quoteOverlay').evaluate(el=>el.hidden),true,'Quote hides after its recorded segment');
    const speechCount=await page.evaluate(()=>__speech.length);
    await page.evaluate(()=>{StorySpot.stop();StorySpot.selectTrack('explanation');StorySpot.togglePlay();});
    await page.waitForFunction(()=>!document.getElementById('audio').paused);
    assert.equal(await page.evaluate(()=>__speech.length),speechCount,'Explanation uses existing recording with no TTS quote');
    assert.equal(await page.locator('#quoteOverlay').evaluate(el=>el.hidden),true);
    assert.deepEqual(errors,[]);
    console.log('Actual controller integration passed: event-synced MCQ sequence, unchanged refresh continuity, recorded-story quote overlay and plain English explanation; screenshots saved.');
  } finally {await browser.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
