/* Display the supplied quotation only during its recorded story-audio interval. */
(() => {
  'use strict';
  let quote = '';
  let start = null;
  let end = null;
  let visible = false;

  function extractQuote(story) {
    const explicit = story?.quote;
    if (explicit && typeof explicit.text === 'string' && explicit.text.trim()) return explicit.text.trim();
    const matches = [...String(story?.storyText || '').matchAll(/«([^«»]+)»/gu)];
    return matches.length ? matches.at(-1)[1].trim() : '';
  }
  function render(show) {
    visible = !!show;
    const element = document.getElementById('quoteOverlay');
    const text = document.getElementById('quoteText');
    if (text) text.textContent = quote;
    if (element) element.hidden = !visible;
  }
  function stop() { render(false); }
  window.StorySpotQuotes = {
    load(story) {
      stop();
      quote = extractQuote(story);
      const supplied = story?.quote;
      const valid = typeof supplied?.start === 'number' && Number.isFinite(supplied.start) && supplied.start >= 0 &&
        typeof supplied?.end === 'number' && Number.isFinite(supplied.end) && supplied.end > supplied.start;
      start = valid ? supplied.start : null;
      end = valid ? supplied.end : null;
      render(false);
    },
    hasQuote() { return !!quote; },
    showAt(time, enabled) {
      // No estimated timing: without an explicit reviewed interval, stay hidden.
      render(enabled === true && !!quote && start !== null && Number.isFinite(time) && time >= start && time < end);
    },
    pause:stop,
    stop,
    get isPlaying() { return visible; },
    get isVisible() { return visible; },
    extractQuote
  };
})();
