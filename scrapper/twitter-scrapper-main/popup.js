/* TODO:
 *
 * Devise a horizontal slider UI widget that occupies the top of the page, in a frame showing the generated HTML pages below it.
 * The slider's frame should ideally be preserved across clickthroughs of the HTML pages.  Back button should still work.
 * Initially make the slider select a page number for the current thread.  Then, in a config file make a hash table mapping calendar dates
 * (retrieved from the first post timestamp of each HTML page) onto percentages (0% = earliest date in table, 100% = latest);
 * selecting a slider level selects that percentage and navigates to the correct date.  Hovering over the slider previews the date that would be chosen.
 * Finally, unify this hash table across all threads in the series, so the config file should break its dates into sections depending on the start/end date of each thread, and select the proper thread accordingly; these dates will not overlap.
 *    Or just programmatically unify all the threads and update page number references everywhere?
 *        This would hide thread OPs / transitions, and throw out the original page numbers.
 *
 * Lower Priority:
 *
 * Minor formatting differences from SA.
 *
 * Follow external non-twitter links and archive the complete .mhtml - too big?  Too hard?
 *
 * In scraper, handle cases where clone.innerHTML needs sanitization, if/when testing ever encounters a live post containing HTML, possibly in a code block.
 *
 * Unknown if non-preview URLs within tweet content can exist.
 *
 * Bugs:
 *
 * Splitting a thread across multiple scraper runs will break any post quote links that go to before the current run.
 *
 * Tagged handles in tweets don't link to the account, but to just file://handle
 *
 * Tweet replies can't exactly be embedded directly.
 *   It just grabs the main tweet, showing replies in the archive case but probably not the live case, where it would be missing.
 *   Unfortunately nothing can be done about main tweets, which now hide parent tweets if not logged in.  But it SHOULD show the reply.
 *
 * Intermittent: The SA timg scraper sometimes replaces blocks like these with just an img:
 * <span class="timg_container"><img src="https://i.kym-cdn.com/photos/images/newsfeed/001/777/149/a8c.gif" alt="" class="timg complete" border="0"><div class="note" title="Click to toggle">600x337</div></span>
 *
 * Intermittent pause/resume weirdness; may want to double check or redo pages near the pause point.
 */

document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('startButton');
  const pauseBtn = document.getElementById('pauseButton');
  const resumeBtn = document.getElementById('resumeButton');
  const statusText = document.getElementById('status');
  const progressContainer = document.getElementById('progressContainer');
  const progressLabel = document.getElementById('progressLabel');
  const maxPagesInput = document.getElementById('maxPagesInput');

  let isRunning = false;
  let resumePage = null;

  function updateButtons() {
    const canResume = resumePage !== null;

    startBtn.disabled  = isRunning || isPaused;                 // can't Start while running or paused
    pauseBtn.disabled  = !isRunning;                            // only pause when running
    resumeBtn.disabled = isRunning || (!isPaused && !canResume);
  }


  // Initial load
  chrome.runtime.sendMessage({ command: 'getStatusAndResume' }, response => {
    isRunning = response?.isRunning || false;
    isPaused = response?.isPaused || false;
    resumePage = (typeof response?.resumePage === "number" && response.resumePage >= 0)
      ? response.resumePage
      : null;

    // Status + progress
    if (isRunning) {
      statusText.textContent = 'Scraping in progress...';
      progressContainer.style.display = 'block';
    } else if (isPaused) {
      statusText.textContent = 'Paused.';
      progressContainer.style.display = 'block';
    } else if (resumePage !== null) {
      statusText.textContent = `Can resume from page ${resumePage + 1}`;
      progressContainer.style.display = 'block';
    } else {
      statusText.textContent = 'Ready to start new archive';
      progressContainer.style.display = 'none';
    }

    updateButtons();
  });

  startBtn.addEventListener('click', () => {
    const startPage = parseInt(startPageInput.value, 10) || 1;
    const maxPages = parseInt(maxPagesInput.value, 10) || 1;
    chrome.runtime.sendMessage({ command: 'start-scrape', startPage, maxPages });
    isRunning = true;
    updateButtons();
    progressContainer.style.display = 'block';
    statusText.textContent = 'Scraping started...';
    progressLabel.textContent = `0 / ${maxPages}`;
  });

  pauseBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ command: 'pause' });
    isRunning = false;
    updateButtons();
    statusText.textContent = 'Paused.';
  });

  resumeBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ command: 'resume' });
    isRunning = true;
    updateButtons();
    statusText.textContent = 'Resuming scraping...';
  });

  // Twitter search button
  const twitterSearchBtn = document.getElementById('twitterSearchButton');
  const twitterQueryInput = document.getElementById('twitterQuery');
  
  twitterSearchBtn.addEventListener('click', () => {
    const query = twitterQueryInput.value.trim() || 'Bitcoin';
    chrome.runtime.sendMessage({ command: 'start-twitter-search', query });
    statusText.textContent = `Scraping Twitter for "${query}"...`;
  });

  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === 'status') {
      statusText.textContent = msg.text;
    }
    if (msg.type === 'progressUpdate') {
      progressLabel.textContent = `${msg.page} / ${msg.max}`;
      progressContainer.style.display = 'block';
    }
  });

});

