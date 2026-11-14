(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const audio = $('audio');
  const state = {catalog:null, stories:[], visible:[], index:0, track:'story', saved:new Set(readStorage('storyspot.saved',[])), savedOnly:false, rate:1, muted:false, preview:false, previewTime:0, playing:false, duration:0, startY:null, frame:0, loading:true, syncing:false, booted:false, lastSync:0, manualSync:false, connected:false};
  let preparedAudio=null, audioPreparation=null, audioAbort=null;
  let toastTimer, lastFrame=0, playbackGeneration=0, pendingCatalog=null;
  state.playIntent=false; state.buffering=false;
  const DEFAULT_FOLDER='https://drive.google.com/drive/folders/1eVNE4gXZUVkd0sP7uvrTa3SvB7k2EHaT';
  function readStorage(key,fallback){try{return JSON.parse(window.StorySpotNative?.getItem?.(key)||localStorage.getItem(key))??fallback;}catch{return fallback;}}
  function store(key,value){try{localStorage.setItem(key,JSON.stringify(value));window.StorySpotNative?.setItem?.(key,JSON.stringify(value));}catch{}}
  function current(){return state.visible[state.index];}
  function setPlaybackActive(active) {
    try { window.StorySpotNative?.setPlaybackActive?.(!!active); } catch (_) { /* Older native hosts have no focus bridge. */ }
  }
  function trackAudio(s=current()){if(state.track==='mcq')return null;return s ? (state.track==='story'?s.storyAudio:s.explanationAudio)||null:null;}
  function trackText(s=current()){if(state.track==='mcq')return window.StorySpotMCQ?.transcript?.()||'';return s ? (state.track==='story'?s.storyText:s.explanationText)||'': '';}
  function cues(s=current()) {
    const list=s&&(state.track==='story'?(s.cues||s.storyCues):s.explanationCues);
    return Array.isArray(list)?list.filter(c=>c && Number.isFinite(Number(c.time)) && Number(c.time)>=0 && Number.isFinite(Number(c.x)) && Number.isFinite(Number(c.y))).map(c=>({...c,time:Number(c.time)})).sort((a,b)=>a.time-b.time):[];
  }
  function seconds(){if(state.track==='mcq')return window.StorySpotMCQ?.currentTime?.()||0;return state.preview ? state.previewTime : audio.currentTime||0;}
  function clock(n){n=Number.isFinite(n)?Math.max(0,Math.floor(n)):0;return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;}
  function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3200);}
  function safeMedia(src){
    if(typeof src!=='string')return '';
    const value=src.trim();
    // Old APK media paths no longer exist. Keep saved IDs, but never revive their bundled media.
    if(/(?:^|\/)(?:content\/(?:images|audio)|assets\/content)\//i.test(value))return '';
    return /^(https:\/\/|blob:|data:image\/)/i.test(value)?value:'';
  }
  function normalizeCatalog(catalog){
    if(!catalog||!Array.isArray(catalog.stories))throw new Error('This library needs a stories array.');
    const ids=new Set();
    return {...catalog,stories:catalog.stories.map((s,i)=>{
      if(!s||typeof s!=='object'||!s.id||!s.image)return null;
      const image=safeMedia(s.image);if(!image)return null;
      if(ids.has(String(s.id)))throw new Error(`Duplicate story id: ${s.id}`);
      ids.add(String(s.id));
      return {...s,id:String(s.id),title:String(s.title||`Visual story ${i+1}`),image,storyAudio:safeMedia(s.storyAudio),explanationAudio:safeMedia(s.explanationAudio)};
    }).filter(Boolean)};
  }
  function storyFingerprint(s){return s?JSON.stringify([s.id,s.title,s.subtitle,s.image,s.storyAudio,s.explanationAudio,s.storyText,s.explanationText,s.cues,s.explanationCues,s.mcq,s.quote]):'';}
  function loadCatalog(data,announce=false){
    try{
      const catalog=normalizeCatalog(data),before=current(),id=before?.id||readStorage('storyspot.last',null);
      const incoming=catalog.stories.find(s=>s.id===id);
      // A refresh must never replace the current source or timing under a voice
      // that is already playing (including a pending play or buffering).
      if(before && (state.playing||state.playIntent) && storyFingerprint(before)!==storyFingerprint(incoming)) {
        pendingCatalog={data:catalog,announce};
        $('syncStatus').textContent='Library update ready. It will apply after this track finishes.';
        return true;
      }
      pendingCatalog=null;
      window.StorySpotSync?.useCatalog?.(catalog);state.catalog=catalog;state.stories=catalog.stories;
      state.visible=state.savedOnly?state.stories.filter(s=>state.saved.has(s.id)):state.stories;
      state.index=Math.max(0,state.visible.findIndex(s=>s.id===id));
      const folder=catalog.folderUrl||catalog.driveFolder||DEFAULT_FOLDER;
      $('driveLink').href=/^https:\/\/drive\.google\.com\//.test(folder)?folder:DEFAULT_FOLDER;
      if(before&&before.id===current()?.id&&before.image===current().image&&before.storyAudio===current().storyAudio&&before.explanationAudio===current().explanationAudio){
        renderStoryInfo(current());
        if(state.track==='mcq'&&JSON.stringify(before.mcq)!==JSON.stringify(current().mcq)){
          window.StorySpotMCQ?.load?.(current());
          const enabled=!!window.StorySpotMCQ?.hasContent?.();
          $('playButton').disabled=!enabled;$('restartButton').disabled=!enabled;$('seek').disabled=!enabled;
          $('playerNote').textContent=enabled?'Question → correct answer → other options.':'Add this question and its answer key to the book’s MCQ file.';
          renderPlay();renderTimeline();
        }
        if(before.storyText!==current().storyText||JSON.stringify(before.quote)!==JSON.stringify(current().quote))window.StorySpotQuotes?.load?.(current());
        if(state.track!=='mcq'){
          const duration=state.track==='story'?current().duration:current().explanationDuration;
          state.duration=Number.isFinite(audio.duration)&&audio.duration>0?audio.duration:Number(duration)||0;
          if(trackAudio())$('playerNote').textContent=cues().length?'Spotlight follows the voice.':'Audio ready · add timing for the spotlight.';
        }
        updateSaved();renderLibrary();updateEmptyState();renderTimeline();drawScene();
      }else renderStory();
      if(announce)toast(`${state.stories.length} stories ready`);
      return true;
    }catch(error){toast(error.message||'Could not read the library.');return false;}
  }
  function updateEmptyState(){
    const empty=!current();$('emptyState').hidden=!empty;$('viewer').classList.toggle('is-empty',empty);
    $('emptyState').classList.toggle('loading',state.loading||state.syncing);
    if(state.savedOnly){$('emptyTitle').textContent='Your saved stories.';$('emptyMessage').textContent='Save a story and it will appear here.';$('emptyLibrary').textContent='Discover stories';}
    else if(state.loading||state.syncing){$('emptyTitle').textContent='Loading your Drive library';$('emptyMessage').textContent='Your images and stories will appear here.';$('emptyLibrary').textContent='Syncing…';}
    else if(state.connected){$('emptyTitle').textContent='Your next story starts in Drive.';$('emptyMessage').textContent='Add an image to your Google Drive folder, then tap Sync.';$('emptyLibrary').textContent='Sync from Drive';}
    else{$('emptyTitle').textContent='Your stories are in Drive.';$('emptyMessage').textContent='Connect to the internet to load your Google Drive library';$('emptyLibrary').textContent='Sync from Drive';}
    $('emptyLibrary').disabled=!state.savedOnly&&(state.loading||state.syncing);
    $('refreshButton').classList.toggle('syncing',state.syncing);$('refreshButton').disabled=state.syncing;
    $('refreshButton').setAttribute('aria-busy',String(state.syncing));$('syncButton').disabled=state.syncing;
  }
  async function start(){
    store('storyspot.imported',null);
    let config={title:'StorySpot',folderUrl:DEFAULT_FOLDER,stories:[]};
    try{const response=await fetch('config.json',{cache:'no-cache'});if(response.ok)config={...config,...await response.json(),stories:[]};}catch{ /* The remote cache can still open offline. */ }
    loadCatalog(window.StorySpotSync?.init(config)||config);
    window.StorySpotBooks?.render?.();
    state.booted=true;state.loading=!state.stories.length;
    if(state.stories.length)$('syncStatus').textContent='Downloaded stories ready. Checking Drive for updates…';
    updateEmptyState();if(window.StorySpotNative?.ready)window.StorySpotNative.ready();
    await sync({quiet:true});
  }
  function stop() {
    playbackGeneration++;state.preparing=false;state.playIntent=false;state.playing=false;state.buffering=false;setPlaybackActive(false);
    audio.pause();window.StorySpotMCQ?.stop?.();window.StorySpotQuotes?.stop?.();state.preview=false;state.previewTime=0;
    cancelAnimationFrame(state.frame);renderPlay();
  }
  function applyPendingCatalog() {
    if(!pendingCatalog)return;
    const next=pendingCatalog;pendingCatalog=null;loadCatalog(next.data,next.announce);
  }
  function renderStoryInfo(s){
    $('nextButton').disabled=state.visible.length<2;
    $('storyTitle').textContent=s.title;$('storySubtitle').textContent=s.subtitle||'A story to see. An idea to remember.';
    $('storyCategory').textContent=s.category||'LEARN THROUGH A STORY';$('storyImage').alt=s.imageAlt||s.title;
    $('storyNumber').textContent=String(state.index+1).padStart(2,'0');
    $('positionLabel').textContent=`${String(state.index+1).padStart(2,'0')} / ${String(state.visible.length).padStart(2,'0')}`;
    const chips=[{text:s.storyAudio?'Story audio':'Story audio needed',pending:!s.storyAudio},
      {text:s.explanationAudio?'Explanation audio':'Explanation audio needed',pending:!s.explanationAudio}];
    if(!(s.cues?.length||s.explanationCues?.length))chips.push({text:'Timing needed',pending:true});
    $('assetStatus').replaceChildren(...chips.map(chip=>{const el=document.createElement('span');el.className=`asset-chip${chip.pending?' pending':''}`;el.textContent=chip.text;return el;}));
  }
  function renderStory(){stop();const s=current();const empty=!s;updateEmptyState();$('saveButton').disabled=empty;$('transcriptButton').disabled=empty;$('nextButton').disabled=state.visible.length<2;updateSaved();if(empty){audio.removeAttribute('src');audio.load();$('storyTitle').textContent=state.savedOnly?'Your saved stories.':'Your next discovery starts here.';$('storySubtitle').textContent='One image. A story that stays.';$('storyImage').removeAttribute('src');$('backdrop').style.backgroundImage='none';$('assetStatus').replaceChildren();$('pointer').hidden=true;$('motionLabel').hidden=true;$('storyNumber').textContent='00';$('positionLabel').textContent='00 / 00';setupTrack();return;}
    renderStoryInfo(s);$('storyImage').src=s.image;$('backdrop').style.backgroundImage=`url(${JSON.stringify(s.image)})`;
    setupTrack();store('storyspot.last',s.id);renderLibrary();prefetchNeighbors();}
  function setupTrack() {
    playbackGeneration++;state.preparing=false;state.playIntent=false;state.playing=false;state.buffering=false;setPlaybackActive(false);
    window.StorySpotQuotes?.load?.(current());
    const mcq=state.track==='mcq';
    $('viewer').classList.toggle('mcq-mode',mcq);
    if($('mcqOverlay'))$('mcqOverlay').hidden=!mcq;
    if(mcq)window.StorySpotMCQ?.load?.(current());
    audioAbort?.abort();audioAbort=null;audioPreparation=null;
    if(preparedAudio)URL.revokeObjectURL(preparedAudio);
    preparedAudio=null;
    const src=trackAudio();state.preview=false;state.previewTime=0;
    state.duration=Number(state.track==='story'?current()?.duration:current()?.explanationDuration)||0;
    audio.pause();audio.removeAttribute('src');audio.load();
    audio.playbackRate=state.rate;audio.muted=state.muted;
    if(src){audio.src=src;audio.load();}
    const points=cues(),enabled=mcq?!!window.StorySpotMCQ?.hasContent?.():!!src;
    if(mcq)state.duration=window.StorySpotMCQ?.duration?.()||0;
    $('playButton').disabled=!enabled;$('restartButton').disabled=!enabled;$('seek').disabled=!enabled;
    $('storyTrack').classList.toggle('selected',state.track==='story');$('explainTrack').classList.toggle('selected',state.track==='explanation');
    $('storyTrack').setAttribute('aria-pressed',state.track==='story');$('explainTrack').setAttribute('aria-pressed',state.track==='explanation');
    if($('mcqTrack')){$('mcqTrack').classList.toggle('selected',mcq);$('mcqTrack').setAttribute('aria-pressed',String(mcq));}
    $('playbackLabel').textContent=!current()?'Your Drive library':src?(state.track==='story'?'Story audio':'Explanation audio'):'Audio not added yet';
    $('playerNote').textContent=!current()?'Your Google Drive library, always with you.':src?(points.length?'Spotlight follows the voice.':'Audio ready · add timing for the spotlight.'):(current()?.storyText?'Read the story while audio is being added.':'Image ready · Add story text and audio in Drive.');
    if(mcq){$('playbackLabel').textContent='MCQ narration';$('playerNote').textContent=enabled?'Question → correct answer → other options.':'Add this question and its answer key to the book’s MCQ file.';}
    $('imagePlay').hidden=!src||mcq;$('imagePlay').setAttribute('aria-label','Play '+(state.track==='story'?'story':'explanation')+' audio');
    renderPlay();renderTimeline();drawScene();
  }
  function renderPlay() {
    const playing=state.playing||state.playIntent;
    $('playIcon').innerHTML=playing?'<path d="M7 5h4v14H7zM14 5h4v14h-4z"/>':'<path d="M8 5v14l11-7z"/>';
    $('playButton').setAttribute('aria-label',playing?'Pause':'Play audio');
    $('playButton').setAttribute('aria-busy',String(state.buffering));
    $('imagePlay').hidden=state.track==='mcq'||playing||!trackAudio();
  }
  function animate() {
    cancelAnimationFrame(state.frame);lastFrame=0;state.frame=requestAnimationFrame(tick);
  }
  async function completeAudioSource() {
    const source=trackAudio(),url=new URL(source,location.href);
    // Avoid relying on intercepted range streams during accelerated playback.
    // Hand its decoder a complete local Blob, after native download/hash checks.
    // External/browser URLs retain their ordinary streaming behavior.
    if(url.origin!==location.origin||!/^\/(remote|cache)\/[a-f0-9]{64}$/.test(url.pathname))return null;
    if(preparedAudio)return preparedAudio;
    state.buffering=true;renderPlay();$('playerNote').textContent='Preparing audio…';
    if(!audioPreparation){
      const controller=new AbortController();audioAbort=controller;
      const timeout=setTimeout(()=>controller.abort(),60000);
      audioPreparation=(async()=>{
        try{
          const response=await fetch(source,{signal:controller.signal});
          if(!response.ok)throw new Error('Audio download failed. Tap Sync and retry.');
          const blob=await response.blob(),length=Number(response.headers.get('Content-Length'));
          if(!blob.size||(length>0&&length!==blob.size))throw new Error('Incomplete audio download. Tap Sync and retry.');
          if(controller.signal.aborted)throw new DOMException('Cancelled','AbortError');
          preparedAudio=URL.createObjectURL(blob);return preparedAudio;
        }finally{clearTimeout(timeout);}
      })();
      // A failed preparation can be retried by an explicit Play.
      audioPreparation.catch(()=>{if(audioAbort===controller)audioPreparation=null;});
    }
    return audioPreparation;
  }
  async function togglePlay() {
    if(!current())return;
    if(state.playing||state.playIntent){
      if(state.track==='mcq'){window.StorySpotMCQ?.pause?.();state.playIntent=false;state.playing=false;setPlaybackActive(false);renderPlay();return;}
      stop();return;
    }
    if(state.track==='mcq'){
      if(!window.StorySpotMCQ?.hasContent?.()){toast('This question needs MCQ data and an answer key.');return;}
      setPlaybackActive(true);state.playIntent=true;renderPlay();window.StorySpotMCQ.play();return;
    }
    if(!trackAudio()){toast('Add recorded audio to this track first.');return;}
    const generation=++playbackGeneration;
    setPlaybackActive(true);state.playIntent=true;renderPlay();
    try {
      if(generation!==playbackGeneration||!state.playIntent)return;
      state.preparing=true;
      const complete=await completeAudioSource();
      if(generation!==playbackGeneration||!state.playIntent)return;
      if(complete&&audio.getAttribute('src')!==complete){
        const position=audio.currentTime||0;
        audio.src=complete;audio.load();audio.currentTime=position;
      }
      audio.playbackRate=state.rate;audio.muted=state.muted;
      await audio.play();
      if(generation!==playbackGeneration||!state.playIntent)return;
      state.preparing=false;state.playing=true;state.buffering=false;animate();renderPlay();
    } catch(error) {
      if(generation!==playbackGeneration)return;
      state.preparing=false;state.playIntent=false;state.playing=false;state.buffering=false;setPlaybackActive(false);renderPlay();drawScene();
      if(error.name!=='AbortError')toast(error.message||'Audio could not play. Check the file or download it again.');
    }
  }
  function tick() {
    if(!state.playing)return;
    renderTimeline();drawScene();state.frame=requestAnimationFrame(tick);
  }
  function renderTimeline(){
    if(state.track==='mcq'){
      const count=window.StorySpotMCQ?.duration?.()||0,index=seconds();state.duration=count;
      $('elapsed').textContent=count?'Step '+Math.min(count,index+1):'Step 0';$('duration').textContent=String(count);
      $('seek').max=Math.max(0,count-1);$('seek').step='1';$('seek').value=index;
      $('seek').style.setProperty('--progress',`${count>1?index/(count-1)*100:0}%`);return;
    }
    $('seek').step='0.01';const d=state.duration||0;const t=seconds();$('elapsed').textContent=clock(t);$('duration').textContent=clock(d);$('seek').max=d||100;$('seek').value=t;$('seek').style.setProperty('--progress',`${d?Math.min(100,t/d*100):0}%`);}
  function bounded(n,fallback,min,max){n=Number(n);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;}
  function focusAt(time) {
    // Cues are active intervals, not camera destinations. Interpolating toward
    // the next point highlighted that subject before its words were spoken.
    const inactive={x:.5,y:.5,zoom:1,pointer:false,label:''};
    const points=cues();let cue=null;
    for(const point of points){if(point.time>time)break;cue=point;}
    if(!cue)return inactive;
    const end=Number(cue.endTime??cue.end);
    if((cue.endTime!=null||cue.end!=null)&&Number.isFinite(end)&&time>=end)return inactive;
    return {x:bounded(cue.x,.5,0,1),y:bounded(cue.y,.5,0,1),zoom:1,pointer:cue.pointer!==false,label:String(cue.label||'')};
  }
  function drawScene() {
    window.StorySpotQuotes?.showAt?.(seconds(),state.track==='story'&&state.playing&&!audio.ended);
    const image=$('storyImage'),viewer=$('viewer');
    if(!image.naturalWidth){$('pointer').hidden=true;$('motionLabel').hidden=true;return;}
    const vw=viewer.clientWidth,vh=viewer.clientHeight,fit=Math.min(vw/image.naturalWidth,vh/image.naturalHeight);
    const iw=image.naturalWidth*fit,ih=image.naturalHeight*fit;
    const scene=$('scene');scene.style.width=iw+'px';scene.style.height=ih+'px';
    scene.style.transform=`matrix(1,0,0,1,${(vw-iw)/2},${(vh-ih)/2})`;
    const f=focusAt(seconds());
    const visible=state.track!=='mcq'&&!window.StorySpotQuotes?.isPlaying&&!!trackAudio()&&f.pointer&&!audio.ended;
    $('pointer').hidden=!visible;$('pointer').style.left=(f.x*100)+'%';$('pointer').style.top=(f.y*100)+'%';
    $('motionLabel').hidden=!visible||!f.label;$('motionLabel').textContent=f.label;
  }
  let storyAnimations=[],dragReturn=null,adjacentPrefetch=[];
  const reducedMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  function resetDrag(spring=false){
    const scene=$('scene'),from=scene.style.translate,opacity=scene.style.opacity;
    dragReturn?.cancel();dragReturn=null;
    scene.style.translate='';scene.style.opacity='';
    if(spring&&from&&!reducedMotion()){
      const bounce=scene.animate([{translate:from,opacity:opacity||1},{translate:'0 0',opacity:1}],
        {duration:155,easing:'cubic-bezier(.2,.8,.2,1)'});
      dragReturn=bounce;
      bounce.finished.catch(()=>{}).finally(()=>{if(dragReturn===bounce)dragReturn=null;});
    }
  }
  function prefetchNeighbors(){
    // Only keep the two adjacent images warm. No lesson data is bundled in the APK.
    adjacentPrefetch=[];
    if(state.visible.length<2)return;
    const urls=new Set([-1,1].map(delta=>state.visible[(state.index+delta+state.visible.length)%state.visible.length]?.image).filter(Boolean));
    for(const url of urls){const image=new Image();image.decoding='async';image.src=url;adjacentPrefetch.push(image);}
  }
  function move(delta){
    resetDrag();
    storyAnimations.forEach(animation=>animation.cancel());storyAnimations=[];
    const oldImage=$('storyImage').getAttribute('src'),viewer=$('viewer');
    const resume=state.playing||state.playIntent,hadPending=!!pendingCatalog;
    const previousId=current()?.id;
    const destination=state.visible.length?state.visible[(state.index+delta+state.visible.length)%state.visible.length]?.id:null;
    if(pendingCatalog){stop();applyPendingCatalog();}
    if(state.visible.length<2){if(hadPending&&resume&&current())togglePlay();return;}
    if(hadPending&&previousId!==current()?.id){
      // A removed story is replaced by its intended surviving neighbour.
      const destinationIndex=state.visible.findIndex(s=>s.id===destination);
      if(destinationIndex>=0)state.index=destinationIndex;
    }else state.index=(state.index+delta+state.visible.length)%state.visible.length;
    renderStory();if(resume)togglePlay();
    if(state.track!=='mcq'&&!reducedMotion()&&oldImage){
      const sign=delta>0?1:-1,distance=Math.min(150,Math.max(70,viewer.clientHeight*.24));
      const outgoing=document.createElement('img');
      outgoing.src=oldImage;outgoing.alt='';outgoing.className='swipe-outgoing';
      outgoing.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;background:#151a18;z-index:5;will-change:transform,opacity';
      viewer.append(outgoing);
      const options={duration:190,easing:'cubic-bezier(.16,.78,.24,1)'};
      const exit=outgoing.animate([{transform:'translate3d(0,0,0)',opacity:1},
        {transform:`translate3d(0,${-sign*distance}px,0)`,opacity:0}],options);
      exit.finished.catch(()=>{}).finally(()=>outgoing.remove());
      const enter=$('scene').animate([{translate:`0 ${sign*distance*.7}px`,opacity:.45},
        {translate:'0 0',opacity:1}],options);
      storyAnimations=[exit,enter];
    }
  }
  function updateSaved(){const saved=!!current()&&state.saved.has(current().id);$('saveButton').classList.toggle('saved',saved);$('saveButton').setAttribute('aria-pressed',String(saved));$('saveLabel').textContent=saved?'Saved':'Save';$('savedCount').textContent=state.saved.size;}
  function save(){const s=current();if(!s)return;const saved=state.saved.has(s.id);if(saved)state.saved.delete(s.id);else state.saved.add(s.id);store('storyspot.saved',[...state.saved]);if(state.savedOnly){state.visible=state.stories.filter(s=>state.saved.has(s.id));state.index=Math.min(state.index,Math.max(0,state.visible.length-1));renderStory();}else {updateSaved();renderLibrary();}toast(saved?'Removed from saved':'Saved to your collection');}
  function showDialog(id){const dialog=$(id);if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');}
  function closeDialog(id){const dialog=$(id);if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');}
  function renderLibrary(){$('libraryCount').textContent=`${state.stories.length} ${state.stories.length===1?'story':'stories'}`;$('libraryList').replaceChildren(...state.stories.map(s=>{const row=document.createElement('button');row.className='library-item'+(current()?.id===s.id?' current':'');const img=document.createElement('img');img.className='library-thumb';img.src=s.image;img.alt='';img.loading='lazy';const text=document.createElement('div');const title=document.createElement('b');title.textContent=s.title;const meta=document.createElement('small');const tracks=Number(!!s.storyAudio)+Number(!!s.explanationAudio);meta.textContent=tracks===2?'Story + explanation audio':tracks?'1 audio track ready':s.storyText?'Image + text · awaiting audio':'Image only · ready to explore';text.append(title,meta);const arrow=document.createElement('span');arrow.textContent=state.saved.has(s.id)?'★':'↗';row.append(img,text,arrow);row.onclick=()=>{state.savedOnly=false;$('savedTab').classList.remove('active');document.querySelector('.feed-tabs>span').classList.add('active');state.visible=state.stories;state.index=state.visible.findIndex(item=>item.id===s.id);renderStory();closeDialog('libraryDialog');};return row;}));}
  function showTranscript(){const s=current();if(!s)return;$('transcriptKicker').textContent=state.track==='mcq'?'MCQ':state.track==='story'?'STORY TRANSCRIPT':'EXPLANATION';$('transcriptTitle').textContent=s.title;$('transcriptBody').dir=state.track==='story'?'rtl':'ltr';$('transcriptBody').lang=state.track==='story'?'ar':'en';$('transcriptBody').textContent=trackText()||(state.track==='story'?'No story text has been added yet.':'No explanation text has been added yet.');showDialog('transcriptDialog');}
  async function sync(options={}){
    if(!state.booted||state.syncing)return;
    if(options.quiet&&Date.now()-state.lastSync<20000)return;
    if(navigator.onLine===false){
      state.loading=false;
      const message='You are offline. Previously downloaded media is still available. Connect to the internet, then tap Sync.';
      $('syncStatus').textContent=message;if(!options.quiet)toast(message);updateEmptyState();return;
    }
    state.lastSync=Date.now();state.syncing=true;state.manualSync=!options.quiet;updateEmptyState();
    $('syncStatus').textContent='Checking your Drive collection…';
    try{
      if(window.StorySpotSync?.sync)await window.StorySpotSync.sync({force:!!options.force});
      else throw new Error('Drive sync is available in the Android app.');
    }catch(error){window.onNativeStatus({state:'error',message:error.message||'Could not connect to Drive.'});}
    finally{state.loading=false;state.syncing=false;state.manualSync=false;updateEmptyState();}
  }
  $('playButton').onclick=togglePlay;$('imagePlay').onclick=togglePlay;$('nextButton').onclick=()=>move(1);$('saveButton').onclick=save;$('transcriptButton').onclick=showTranscript;$('libraryButton').onclick=()=>showDialog('libraryDialog');$('emptyLibrary').onclick=()=>{if(state.savedOnly)$('savedTab').click();else sync({force:true});};$('syncButton').onclick=()=>sync({force:true});$('refreshButton').onclick=()=>sync({force:true});$('driveLink').onclick=event=>{if(window.StorySpotNative?.openDriveFolder){event.preventDefault();if(!window.StorySpotNative.openDriveFolder($('driveLink').href))toast('No browser available to open Google Drive.');}};
  function selectTrack(track) {
    if(!['story','explanation','mcq'].includes(track)||state.track===track)return;
    const resume=state.playing||state.playIntent;stop();state.track=track;setupTrack();if(resume)togglePlay();
  }
  $('storyTrack').onclick=()=>selectTrack('story');$('explainTrack').onclick=()=>selectTrack('explanation');
  if($('mcqTrack'))$('mcqTrack').onclick=()=>selectTrack('mcq');
  $('soundButton').onclick=()=>{state.muted=!state.muted;audio.muted=state.muted;window.StorySpotMCQ?.setMuted?.(state.muted);$('soundButton').setAttribute('aria-pressed',String(state.muted));$('soundButton').setAttribute('aria-label',state.muted?'Unmute audio':'Mute audio');$('soundLabel').textContent=state.muted?'Muted':'Sound';if($('mcqSoundButton')){$('mcqSoundButton').textContent=state.muted?'Unmute':'Sound';$('mcqSoundButton').setAttribute('aria-label',state.muted?'Unmute MCQ audio':'Mute MCQ audio');}$('soundIcon').innerHTML=state.muted?'<path d="M4 9v6h4l5 4V5L8 9zM17 9l5 6M22 9l-5 6"/>':'<path d="M4 9v6h4l5 4V5L8 9zM16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14"/>';};
  if($('mcqSoundButton'))$('mcqSoundButton').onclick=()=>$('soundButton').click();
  $('speedButton').onclick=()=>{const rates=[1,1.25,1.5,2,.75];state.rate=rates[(rates.indexOf(state.rate)+1)%rates.length];audio.playbackRate=state.rate;window.StorySpotMCQ?.setRate?.(state.rate);$('speedButton').textContent=state.rate+'×';};
  function seek(time) {
    if(state.track==='mcq')window.StorySpotMCQ?.seek?.(time);
    else if(state.preview)state.previewTime=time;
    else audio.currentTime=time;
    renderTimeline();drawScene();
  }
  $('seek').oninput=event=>seek(Number(event.target.value));$('restartButton').onclick=()=>seek(0);
  $('savedTab').onclick=()=>{state.savedOnly=!state.savedOnly;$('savedTab').classList.toggle('active',state.savedOnly);document.querySelector('.feed-tabs>span').classList.toggle('active',!state.savedOnly);state.visible=state.savedOnly?state.stories.filter(s=>state.saved.has(s.id)):state.stories;state.index=0;renderStory();};
  document.querySelector('.brand').onclick=event=>{event.preventDefault();state.savedOnly=false;$('savedTab').classList.remove('active');document.querySelector('.feed-tabs>span').classList.add('active');state.visible=state.stories;state.index=0;renderStory();};
  document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>closeDialog(button.dataset.close));document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeDialog(dialog.id);}}));
  const gestureControls='button,a,input,textarea,select,label,[contenteditable],#mcqOverlay';
  const gestureBlocked=event=>!!document.querySelector('dialog[open]')||!!event.target.closest(gestureControls);
  let swipeGesture=null;
  $('viewer').addEventListener('touchstart',event=>{
    // A second finger, dialog or control always cancels any pending navigation.
    swipeGesture=null;resetDrag();
    if(event.touches.length!==1||gestureBlocked(event)||state.visible.length<2)return;
    const touch=event.touches[0],now=performance.now();
    swipeGesture={id:touch.identifier,x:touch.clientX,y:touch.clientY,lastY:touch.clientY,
      lastAt:now,velocity:0,moved:false,story:current()?.id,track:state.track};
  },{passive:true});
  $('viewer').addEventListener('touchmove',event=>{
    if(event.touches.length!==1){swipeGesture=null;resetDrag(true);return;}
    const gesture=swipeGesture,touch=event.touches[0];
    if(!gesture||gesture.story!==current()?.id||gesture.track!==state.track||gestureBlocked(event)){
      resetDrag(true);return;
    }
    const dx=touch.clientX-gesture.x,dy=touch.clientY-gesture.y;
    if(Math.abs(dy)<8||Math.abs(dy)<=Math.abs(dx)*1.2){resetDrag();return;}
    gesture.moved=true;
    const now=performance.now(),dt=Math.max(1,now-gesture.lastAt);
    const instantaneous=Math.abs(touch.clientY-gesture.lastY)/dt;
    gesture.velocity=Math.max(instantaneous,gesture.velocity*.72);
    gesture.lastY=touch.clientY;gesture.lastAt=now;
    // Translate only the artwork, never the whole viewer or player controls.
    // Composited transforms remain smooth even while audio spotlight updates.
    if(!reducedMotion()){
      const offset=Math.sign(dy)*Math.min(80,Math.abs(dy)*.62);
      $('scene').style.translate=`0 ${offset}px`;
      $('scene').style.opacity=String(Math.max(.80,1-Math.abs(offset)/450));
    }
    if(event.cancelable)event.preventDefault();
  },{passive:false});
  $('viewer').addEventListener('touchcancel',()=>{swipeGesture=null;resetDrag(true);},{passive:true});
  $('viewer').addEventListener('touchend',event=>{
    const gesture=swipeGesture;swipeGesture=null;
    if(!gesture||event.touches.length||gesture.story!==current()?.id||gesture.track!==state.track||gestureBlocked(event)){
      resetDrag(true);return;
    }
    const touch=Array.from(event.changedTouches).find(item=>item.identifier===gesture.id);
    if(!touch){resetDrag(true);return;}
    const dx=touch.clientX-gesture.x,dy=gesture.y-touch.clientY;
    const threshold=Math.max(38,Math.min(58,$('viewer').clientHeight*.09));
    const fling=gesture.moved&&gesture.velocity>.55&&Math.abs(dy)>=25;
    if((Math.abs(dy)<threshold&&!fling)||Math.abs(dy)<=Math.abs(dx)*1.3){resetDrag(true);return;}
    // Finish immediately on release; one gesture always moves exactly one story.
    if(event.cancelable)event.preventDefault();
    move(dy>0?1:-1);
  },{passive:false});
  let wheelDistance=0,wheelConsumed=false,wheelTimer;
  $('viewer').addEventListener('wheel',event=>{
    if(gestureBlocked(event)||event.ctrlKey||Math.abs(event.deltaY)<=Math.abs(event.deltaX))return;
    event.preventDefault();
    clearTimeout(wheelTimer);
    // Trackpad inertia belongs to the same gesture even when it lasts longer
    // than a fixed cooldown. Rearm only after wheel input has actually stopped.
    wheelTimer=setTimeout(()=>{wheelDistance=0;wheelConsumed=false;},180);
    if(wheelConsumed)return;
    const scale=event.deltaMode===1?16:event.deltaMode===2?$('viewer').clientHeight:1;
    const delta=event.deltaY*scale;
    if(Math.sign(delta)!==Math.sign(wheelDistance))wheelDistance=0;
    wheelDistance+=delta;
    if(Math.abs(wheelDistance)<60)return;
    wheelConsumed=true;move(wheelDistance>0?1:-1);
  },{passive:false});
  document.addEventListener('keydown',event=>{
    if(gestureBlocked(event)||event.altKey||event.ctrlKey||event.metaKey)return;
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();if(!event.repeat)move(event.key==='ArrowDown'?1:-1);
    }
    if(event.code==='Space'){event.preventDefault();if(!event.repeat)togglePlay();}
  });
  const updateDuration=()=>{if(state.track==='mcq')return;if(Number.isFinite(audio.duration)&&audio.duration>0)state.duration=audio.duration;renderTimeline();};
  audio.addEventListener('loadedmetadata',updateDuration);audio.addEventListener('durationchange',updateDuration);
  audio.addEventListener('timeupdate',()=>{renderTimeline();drawScene();});
  audio.addEventListener('playing',()=>{
    if(state.track==='mcq'||!state.playIntent)return;
    state.playing=true;state.buffering=false;animate();renderPlay();
    $('playerNote').textContent=cues().length?'Spotlight follows the voice.':'Audio ready · add timing for the spotlight.';
  });
  const buffering=()=>{if(!state.playIntent)return;state.buffering=true;renderPlay();$('playerNote').textContent='Buffering audio… playback will continue when ready.';};
  audio.addEventListener('waiting',buffering);audio.addEventListener('stalled',buffering);
  audio.addEventListener('pause',()=>{
    // Ignore an old queued pause event after a newer play() already resumed.
    if(state.track==='mcq'||!audio.paused||state.preparing)return;
    state.playing=false;state.playIntent=false;state.buffering=false;setPlaybackActive(false);
    cancelAnimationFrame(state.frame);renderPlay();drawScene();
  });
  audio.addEventListener('ended',()=>{
    if(state.track==='mcq')return;
    playbackGeneration++;state.playing=false;state.playIntent=false;state.buffering=false;setPlaybackActive(false);
    cancelAnimationFrame(state.frame);renderPlay();renderTimeline();drawScene();applyPendingCatalog();
  });
  audio.addEventListener('error',()=>{
    if(state.track==='mcq'||!trackAudio()||!audio.error)return;
    playbackGeneration++;state.preparing=false;state.playIntent=false;state.playing=false;state.buffering=false;setPlaybackActive(false);
    cancelAnimationFrame(state.frame);renderPlay();drawScene();
    $('playerNote').textContent='Audio interrupted. Tap Play to retry, or Sync to download the file again.';
  });
  $('storyImage').onload=drawScene;
  $('storyImage').onerror=()=>{if(current())toast('Image unavailable. Try syncing the collection.');};
  new ResizeObserver(drawScene).observe($('viewer'));
  document.addEventListener('visibilitychange',()=>{
    // Transient visibility changes (system shade, dialogs, app switching) are
    // not user Pause actions. The native host owns lifecycle/audio focus.
    if(!document.hidden){renderTimeline();drawScene();if(state.playing)animate();}
  });
  window.storyspotBack=()=>{const dialog=document.querySelector('dialog[open]');if(dialog){closeDialog(dialog.id);return true;}return false;};
  window.addEventListener('storyspot:pause',()=>{stop();$('playerNote').textContent='Playback paused by the device. Tap Play to continue.';});
  window.addEventListener('storyspot:resume',()=>sync({quiet:true}));
  window.addEventListener('focus',()=>sync({quiet:true}));
  window.addEventListener('online',()=>sync({quiet:true}));
  window.onNativeCatalog=data=>{try{const value=typeof data==='string'?JSON.parse(data):data;state.loading=false;loadCatalog(value,state.manualSync);}catch{toast('Could not read the Drive library.');}};
  window.onNativeStatus=status=>{
    const value=typeof status==='string'?{message:status}:status;
    $('syncStatus').textContent=value.state==='success'&&pendingCatalog?
      'Library update ready. It will apply after this track finishes.':value.message||'Library updated.';
    if(value.state==='error'){state.loading=false;if(state.manualSync)toast(value.message||'Could not connect to Drive.');}
    if(value.state==='success'){state.loading=false;state.connected=true;}
    updateEmptyState();
  };
  window.addEventListener('storyspot:mcqstate',event=>{
    if(state.track!=='mcq')return;
    const detail=event.detail||{};
    state.playing=!!detail.playing;state.playIntent=!!detail.playing||!!detail.pending;state.buffering=!!detail.pending;
    renderPlay();renderTimeline();drawScene();
    if(!state.playIntent)setPlaybackActive(false);
    if(detail.error)$('playerNote').textContent=String(detail.error);
    if(detail.ended){state.playIntent=false;applyPendingCatalog();}
  });
  window.addEventListener('storyspot:quotestate',event=>{
    if(state.track!=='story')return;
    if(event.detail?.error)$('playerNote').textContent=String(event.detail.error);
  });
  window.StorySpot={state,loadCatalog,focusAt,move,sync,togglePlay,stop,selectTrack,seek,showTranscript};
  setInterval(()=>{if(!document.hidden)sync({quiet:true});},90000);
  start();
})();
