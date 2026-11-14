/* MCQ speech follows actual utterance callbacks, never estimated timers. */
(() => {
  'use strict';
  let model=null, segments=[], index=0, playing=false, pending=false, generation=0, rate=1, muted=false, utterance=null, activeId=null, speechTimer=0, finished=false;
  const listeners=new Map();
  const el=id=>document.getElementById(id);
  const notify=(extra={})=>window.dispatchEvent(new CustomEvent('storyspot:mcqstate',{detail:{playing:playing&&!pending,pending:playing&&pending,segmentIndex:index,...extra}}));
  const clean=value=>typeof value==='string'?value.trim():'';
  function normalize(value){
    if(!value||typeof value!=='object')return null;
    const options=Array.isArray(value.options)?value.options.map((o,i)=>typeof o==='string'?{label:String.fromCharCode(65+i),text:o}:{label:clean(o?.label).toUpperCase(),text:clean(o?.text),explanation:clean(o?.explanation)}):Object.entries(value.options||{}).map(([label,text])=>({label,text:clean(text)}));
    if(!clean(value.stem)||options.length<2||options.some(o=>!o.label||!o.text)||new Set(options.map(o=>o.label)).size!==options.length)return null;
    const key=clean(value.key).toUpperCase();
    return {...value,stem:clean(value.stem),options,key:options.some(o=>o.label===key)?key:null,explanation:clean(value.explanation),keyNote:clean(value.keyNote),language:clean(value.language)||'en-US'};
  }
  function build(m){
    if(!m)return [];
    const result=[{kind:'stem',text:m.stem,spoken:`Question. ${m.stem}`}];
    if(!m.key){
      result.push({kind:'unresolved',explanation:[m.keyNote,m.explanation].filter(Boolean).join(' '),text:m.keyNote||'The supplied source has no unambiguous answer key.',spoken:`Answer key needs review. ${m.keyNote||'The supplied source has no unambiguous answer key.'} ${m.explanation}`});
      for(const o of m.options)result.push({kind:'option',label:o.label,text:o.text,spoken:`Option ${o.label}. ${o.text}. This option has not been graded because the source answer key needs review.`});
    }else if(m.reviewRequired){
      const source=m.options.find(o=>o.label===m.key);
      result.push({kind:'review',label:source.label,text:source.text,explanation:[m.reviewNote,m.explanation].filter(Boolean).join(' '),spoken:`The original source key is option ${source.label}. ${source.text}. This key needs review. ${m.reviewNote||''} ${m.explanation}`});
      for(const o of m.options.filter(o=>o.label!==m.key))result.push({kind:'option',label:o.label,text:o.text,explanation:o.explanation,spoken:`Option ${o.label}. ${o.text}. ${o.explanation||'An explanation was not supplied.'}`});
    }else{
      const correct=m.options.find(o=>o.label===m.key);
      result.push({kind:'correct',label:correct.label,text:correct.text,explanation:m.explanation,spoken:`Correct answer. Option ${correct.label}. ${correct.text}. ${m.explanation||'A detailed explanation was not supplied.'}`});
      for(const o of m.options.filter(o=>o.label!==m.key))result.push({kind:'wrong',label:o.label,text:o.text,explanation:o.explanation,spoken:`Incorrect option ${o.label}. ${o.text}. ${o.explanation||'An explanation of why this option is incorrect was not supplied.'}`});
    }
    return result;
  }
  function render(){
    const body=el('mcqContent');if(!body)return;
    body.replaceChildren();
    if(!model){const p=document.createElement('p');p.textContent='No MCQ is linked to this image yet.';body.append(p);return;}
    const stem=document.createElement('p');stem.className='mcq-stem';stem.textContent=model.stem;stem.dataset.kind='stem';body.append(stem);
    for(const o of model.options){
      const row=document.createElement('div');row.className='mcq-option';row.dataset.option=o.label;
      const label=document.createElement('b');label.textContent=o.label;
      const text=document.createElement('span');text.textContent=o.text;row.append(label,text);body.append(row);
    }
    const reason=document.createElement('p');reason.id='mcqReason';reason.className='mcq-reason';reason.setAttribute('aria-live','polite');body.append(reason);
    if(model.explanationOrigin){const note=document.createElement('p');note.className='mcq-provenance';note.textContent='AI-generated explanations · original question and key';body.append(note);}
    highlight();
  }
  function highlight(){
    const part=segments[index];if(!part)return;
    el('mcqPhase').textContent=part.kind==='stem'?'THE QUESTION':part.kind==='correct'?'CORRECT ANSWER':part.kind==='wrong'?'WHY THIS OPTION IS WRONG':part.kind==='unresolved'?'ANSWER NEEDS REVIEW':part.kind==='review'?'ORIGINAL KEY · NEEDS REVIEW':'OPTION';
    document.querySelectorAll('#mcqContent .active').forEach(n=>{n.classList.remove('active','correct','wrong');n.removeAttribute('aria-current');});
    const target=part.label?Array.from(document.querySelectorAll('#mcqContent [data-option]')).find(n=>n.dataset.option===part.label):el('mcqContent')?.querySelector('[data-kind="stem"]');
    if(target){target.classList.add('active');if(part.kind==='correct'||part.kind==='wrong')target.classList.add(part.kind);target.setAttribute('aria-current','true');}
    const reason=el('mcqReason');if(reason)reason.textContent=part.explanation||(part.kind==='correct'?'A detailed explanation was not supplied.':part.kind==='wrong'?'Why this option is wrong: explanation not supplied.':part.kind==='unresolved'?part.text:'');
    if(target&&reason){
      target.after(reason);
      if(playing){
        // Keep speech focus inside its scrollable panel; scrollIntoView also
        // moved the entire app and hid the playback controls on short screens.
        const container=el('mcqContent');
        container.scrollTop+=target.getBoundingClientRect().top-container.getBoundingClientRect().top;
      }
    }
    if(el('mcqProgress'))el('mcqProgress').textContent=`${index+1} / ${segments.length}`;
  }
  const previous=window.onMCQSpeech;
  window.onMCQSpeech=response=>{
    const handler=listeners.get(response?.id);
    if(handler)handler(response);else if(typeof previous==='function')previous(response);
  };
  function cancelSpeech(){
    clearTimeout(speechTimer);generation++;playing=false;pending=false;
    if(activeId){listeners.delete(activeId);activeId=null;window.StorySpotNative?.stopMcq?.();}
    if(utterance){speechSynthesis.cancel();utterance=null;}
  }
  function speakSegment(token){
    if(token!==generation||!playing)return;
    const part=segments[index], id=`mcq-${token}-${index}-${Date.now()}`;activeId=id;pending=true;notify();
    const onEvent=e=>{
      if(token!==generation||!playing||id!==activeId)return;
      if(e.state==='start'){pending=false;highlight();notify();}
      else if(e.state==='done'){
        clearTimeout(speechTimer);
        listeners.delete(id);activeId=null;utterance=null;
        if(index+1<segments.length){index++;speakSegment(token);}
        else{playing=false;pending=false;finished=true;notify({ended:true});}
      }else if(e.state==='error'){
        clearTimeout(speechTimer);
        listeners.delete(id);activeId=null;utterance=null;playing=false;pending=false;notify({error:e.error||'The device could not read this MCQ. Check the installed English voice.'});
      }
    };
    speechTimer=setTimeout(()=>{if(token!==generation||!playing||activeId!==id)return;cancelSpeech();notify({error:'Speech did not finish. Check the English voice on this device, then tap Play to retry.'});},180000);
    try {
      if(window.StorySpotNative?.speakMcq){listeners.set(id,onEvent);window.StorySpotNative.speakMcq(id,part.spoken,model.language,rate);}
      else if('speechSynthesis'in window){
        utterance=new SpeechSynthesisUtterance(part.spoken);utterance.lang=model.language;utterance.rate=rate;utterance.volume=muted?0:1;
        utterance.onstart=()=>onEvent({state:'start'});utterance.onend=()=>onEvent({state:'done'});utterance.onerror=e=>onEvent({state:'error',error:e.error});speechSynthesis.speak(utterance);
      }else onEvent({state:'error',error:'Speech is unavailable on this device.'});
    } catch(error) {onEvent({state:'error',error:error.message||'The device could not start MCQ narration.'});}
  }
  function play(){if(!segments.length)return false;if(muted){notify({error:'Turn sound on to read the MCQ.'});return false;}if(playing)return true;if(finished){index=0;finished=false;}playing=true;const token=++generation;speakSegment(token);return true;}
  function pause(){cancelSpeech();notify();}
  function seek(value){const resume=playing;cancelSpeech();finished=false;index=Math.max(0,Math.min(segments.length-1,Math.floor(Number(value)||0)));highlight();if(resume)play();else notify();}
  window.StorySpotMCQ={
    load(story){cancelSpeech();model=normalize(story?.mcq);segments=build(model);index=0;finished=false;render();},
    hasContent:()=>!!model,play,pause,stop(){cancelSpeech();index=0;finished=false;highlight();notify();},seek,
    currentTime:()=>index,duration:()=>segments.length,
    setRate(value){const resume=playing;cancelSpeech();rate=value;if(resume)play();},
    setMuted(value){muted=!!value;if(muted&&playing)pause();},
    transcript:()=>segments.map(p=>p.spoken).join('\n\n'),
    get isSpeaking(){return playing;},normalize,buildSegments:build
  };
})();
