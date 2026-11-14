/* Each book opens its own Drive catalog without clearing downloaded content. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  function render(){
    const sync=window.StorySpotSync,select=$('bookSelect');if(!sync?.listBooks||!select)return;
    const selected=sync.currentBook()?.id;
    select.replaceChildren(...sync.listBooks().map(book=>{const o=document.createElement('option');o.value=book.id;o.textContent=book.name;o.selected=book.id===selected;return o;}));
  }
  async function choose(id){
    const app=window.StorySpot;if(!app)return;
    app.stop();app.state.savedOnly=false;app.state.connected=false;
    $('savedTab').classList.remove('active');document.querySelector('.feed-tabs>span').classList.add('active');
    const sync=window.StorySpotSync,sameBook=sync.currentBook()?.id===id;
    const catalog=sync.selectBook(id);
    // Selecting this book again also exits Saved. selectBook deliberately
    // skips its change callback for the current book, so restore Discover now
    // even if the following network refresh cannot complete.
    if(sameBook&&catalog)app.loadCatalog(catalog);
    render();
    // Wait for an app-level old refresh to leave its finally block before a new one.
    if(app.state.syncing){
      const wait=()=>{if(app.state.syncing){setTimeout(wait,100);return;}app.sync({force:true});};wait();
    }else await app.sync({force:true});
  }
  $('bookSelect').onchange=event=>choose(event.target.value);
  $('addBookButton').onclick=()=>{$('bookForm').hidden=false;$('bookName').focus();};
  $('cancelBook').onclick=()=>{$('bookForm').hidden=true;$('bookError').textContent='';};
  $('bookForm').onsubmit=async event=>{
    event.preventDefault();
    try{const book=window.StorySpotSync.addBook($('bookName').value,$('bookFolder').value);$('bookError').textContent='';$('bookForm').reset();$('bookForm').hidden=true;await choose(book.id);}
    catch(error){$('bookError').textContent=error.message;}
  };
  document.addEventListener('DOMContentLoaded',render);
  window.addEventListener('storyspot:books',render);
  // App init restores the selected book after this script executes.
  window.StorySpotBooks={render,choose};
})();
