/* No framework or build step. The official SignalR client is served locally. */
(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const app = $('#app');
  const modal = $('#modal');
  let room = null;
  let connection = null;
  let joinedId = null;
  let connected = false;
  let busy = false;
  let toastTimeout;
  let modalReturnFocus = null;
  let initialJoin = false;
  const deckNames = { fibonacci: 'Fibonacci', modified: 'Modified Fibonacci', tshirt: 'T-shirt sizes', powers: 'Powers of two' };
  const icons = {
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    link: '<path d="m10 13 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 2 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 1)"/>',
    settings: '<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="m10 2-1 3-3 1-3-1-2 4 2 2v3l-2 2 2 4 3-1 3 1 1 3h4l1-3 3-1 3 1 2-4-2-2v-3l2-2-2-4-3 1-3-1-1-3Z" transform="translate(1 -1) scale(.92)"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    reset: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7"/>',
    exit: '<path d="M9 21H4V3h5m5 5 4 4-4 4m-6-4h14"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    spark: '<path d="m12 3 2.8 6.2L21 12l-6.2 2.8L12 21l-2.8-6.2L3 12l6.2-2.8Z"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    crown: '<path d="m3 6 5 4 4-7 4 7 5-4-2 12H5ZM5 21h14"/>',
    card: '<rect x="5" y="2" width="14" height="20" rx="3"/><path d="m9 12 3-4 3 4-3 4Z"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3v.1"/>'
  };
  const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.card}</svg>`;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const brand = () => `<a class="brand" href="/" aria-label="Common Ground home"><img src="/favicon.svg" width="38" height="38" alt=""><span>common<span class="brand-light">ground</span><small>PLANNING POKER</small></span></a>`;
  const deckOptions = selected => Object.entries(deckNames).map(([key, name]) => `<option value="${key}" ${selected === key ? 'selected' : ''}>${name}</option>`).join('');
  function read(key, fallback = '') { try { return sessionStorage.getItem(key) || fallback; } catch { return fallback; } }
  function save(key, value) { try { sessionStorage.setItem(key, value); } catch { /* An active session still works without storage. */ } }
  function forget(key) { try { sessionStorage.removeItem(key); } catch { /* Storage is optional. */ } }
  function toast(message, error = false) {
    clearTimeout(toastTimeout);
    $('#toast').textContent = message;
    $('#toast').className = `show ${error ? 'error' : ''}`;
    toastTimeout = setTimeout(() => { $('#toast').className = ''; }, 4500);
  }
  function errorMessage(error) {
    return String(error?.message || 'Something went wrong. Please try again.').replace(/^.*HubException:\s*/, '').replace(/^An unexpected error occurred invoking '[^']+' on the server\.\s*/, '');
  }
  function showModal(title, content) {
    if (modal.open) modal.close();
    modalReturnFocus = document.activeElement;
    modal.innerHTML = `<div class="modal-heading"><h2 id="modal-title">${esc(title)}</h2><button type="button" class="icon-button" data-close aria-label="Close dialog">${icon('close')}</button></div>${content}`;
    $('[data-close]', modal).onclick = () => modal.close();
    modal.showModal();
  }
  modal.addEventListener('close', () => {
    if (modalReturnFocus?.isConnected) modalReturnFocus.focus();
  });
  modal.addEventListener('click', event => { if (event.target === modal && (event.clientX < modal.getBoundingClientRect().left || event.clientX > modal.getBoundingClientRect().right || event.clientY < modal.getBoundingClientRect().top || event.clientY > modal.getBoundingClientRect().bottom)) modal.close(); });

  function landing(tab = 'create', roomId = '') {
    app.innerHTML = `<div class="landing entry-page">
      <header class="landing-header">${brand()}<button class="text-button" data-how>${icon('help')} How to play</button></header>
      <main class="landing-main entry-main">
        <section class="start-panel" aria-label="Start planning"><h1>${tab === 'join' ? 'Join a session' : 'Start a Session'}</h1><p>${tab === 'create' ? 'Create a session and share its link with your team.' : roomId ? 'Enter your name to join this planning poker session.' : 'Enter your name and session ID to start estimating.'}</p>
          <div class="tabs" role="tablist" aria-label="Session action"><button id="create-tab" role="tab" aria-selected="${tab === 'create'}" aria-controls="start-form" tabindex="${tab === 'create' ? '0' : '-1'}" data-tab="create">${icon('plus')} Start a Session</button><button id="join-tab" role="tab" aria-selected="${tab === 'join'}" aria-controls="start-form" tabindex="${tab === 'join' ? '0' : '-1'}" data-tab="join">${icon('users')} Join session</button></div>
          <form id="start-form" role="tabpanel" aria-labelledby="${tab}-tab">
            <label for="player-name">Your name <span>so the team knows it’s you</span></label><input id="player-name" name="playerName" autocomplete="nickname" maxlength="40" placeholder="e.g. Alex" value="${esc(read('playerName'))}" required>
            ${tab === 'create' ? `<label for="session-name">Session name <span>optional</span></label><input id="session-name" name="sessionName" maxlength="80" placeholder="e.g. Sprint 24 planning"><label for="deck">Your card deck</label><div class="select-wrap"><select id="deck" name="deck">${deckOptions('fibonacci')}</select></div><div class="deck-peek" aria-hidden="true"><span>0</span><span>1</span><span>2</span><span>3</span><span>5</span><span>8</span><span>13</span><span>…</span></div>` : `<label for="session-id">Session ID</label><input id="session-id" name="roomId" class="code-input" maxlength="100" placeholder="8-character ID or invite link" value="${esc(roomId)}" required><label class="check-label"><input type="checkbox" name="spectator"> Join as a spectator <span>Follow along without voting</span></label>`}
            <p class="form-error" id="start-error" role="alert"></p><button class="button primary full" type="submit">${tab === 'create' ? 'Start a Session' : 'Join session'} ${icon('arrow')}</button>
          </form>
        </section>
      </main>
    </div>`;
    $('[data-how]').onclick = howItWorks;
    document.querySelectorAll('[data-tab]').forEach(button => {
      button.onclick = () => { const name = $('#player-name').value; save('playerName', name); landing(button.dataset.tab, roomId); $(`#${button.dataset.tab}-tab`).focus(); };
      button.onkeydown = event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); $(`[data-tab="${button.dataset.tab === 'create' ? 'join' : 'create'}"]`).click(); } };
    });
    if ($('#deck')) $('#deck').onchange = event => {
      const cards = { fibonacci: ['0','1','2','3','5','8','13','…'], modified: ['0','1','2','3','5','8','20','…'], tshirt: ['XS','S','M','L','XL','XXL','?','☕'], powers: ['0','1','2','4','8','16','32','…'] };
      $('.deck-peek').innerHTML = cards[event.target.value].map(c => `<span>${c}</span>`).join('');
    };
    $('#start-form').onsubmit = async event => {
      event.preventDefault();
      if (busy) return;
      busy = true;
      const form = event.target;
      const submit = $('button[type="submit"]', form);
      submit.disabled = true;
      $('#start-error').textContent = '';
      const data = new FormData(form);
      const name = String(data.get('playerName')).trim();
      save('playerName', name);
      try {
        let id;
        let token = null;
        if (tab === 'create') {
          const response = await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerName: name, name: data.get('sessionName'), deck: data.get('deck') }) });
          if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || (response.status === 429 ? 'Too many sessions created. Please wait a minute.' : 'Could not create a session. Try again.')); }
          const credentials = await response.json();
          id = credentials.roomId;
          token = credentials.token;
          save(`room:${id}`, token);
        } else {
          id = parseRoomId(String(data.get('roomId')));
          token = read(`room:${id}`) || null;
        }
        await join(id, token, name, data.get('spectator') === 'on');
        history.pushState({}, '', `/room/${id}`);
      } catch (error) {
        if ($('#start-error')) $('#start-error').textContent = errorMessage(error);
        else toast(errorMessage(error), true);
      } finally { busy = false; submit.disabled = false; if (room) renderRoom(); }
    };
  }

  function parseRoomId(value) {
    let candidate = value.trim();
    if (/^https?:\/\//i.test(candidate)) { try { candidate = new URL(candidate).pathname.split('/').filter(Boolean).at(-1) || ''; } catch { candidate = ''; } }
    candidate = candidate.toUpperCase().replace(/[\s-]/g, '');
    if (!/^[A-F0-9]{8}$/.test(candidate)) throw new Error('Enter the 8-character session ID or a valid invite link.');
    return candidate;
  }

  async function ensureConnection() {
    if (!window.signalR) throw new Error('The connection library could not load. Please refresh the page.');
    if (!connection) {
      connection = new signalR.HubConnectionBuilder().withUrl('/hubs/poker').withAutomaticReconnect([0, 1000, 3000, 5000, 10000, 20000]).configureLogging(signalR.LogLevel.Warning).build();
      connection.on('RoomUpdated', update => {
        if (room && update.id === room.id && update.version < room.version) return;
        const wasRevealed = room?.revealed;
        room = update;
        connected = true;
        renderRoom();
        if (!wasRevealed && update.revealed) toast('Votes revealed.');
      });
      connection.on('RoomExpired', () => { room = null; joinedId = null; connected = false; connection.stop(); if (modal.open) modal.close(); landing(); history.replaceState({}, '', '/'); toast('This session expired after 12 hours of inactivity.', true); });
      connection.onreconnecting(() => { connected = false; if (room) renderRoom(); });
      connection.onreconnected(async () => {
        try { await connection.invoke('Join', { roomId: joinedId, token: read(`room:${joinedId}`) }); }
        catch (error) { connected = false; if (room) renderRoom(); toast(errorMessage(error), true); }
      });
      connection.onclose(() => { connected = false; if (room) renderRoom(); });
    }
    if (connection.state === signalR.HubConnectionState.Disconnected) await connection.start();
  }
  async function join(id, token, name, spectator = false) {
    await ensureConnection();
    initialJoin = true;
    try {
      const credentials = await connection.invoke('Join', { roomId: id, token, name, spectator });
      joinedId = id;
      save(`room:${id}`, credentials.token);
      connected = true;
    } finally { initialJoin = false; }
  }
  async function invoke(method, ...args) {
    if (!connected || !connection || busy) return false;
    busy = true;
    setDisabled(true);
    try { await connection.invoke(method, ...args); return true; }
    catch (error) { toast(errorMessage(error), true); return false; }
    finally {
      busy = false;
      if (room) renderRoom();
      modal.querySelectorAll('[data-online]').forEach(button => { button.disabled = !connected; });
    }
  }
  function setDisabled(disabled) { document.querySelectorAll('[data-online]').forEach(button => { button.disabled = disabled || !connected; }); }

  function renderRoom() {
    if (!room) return;
    const me = room.members.find(m => m.id === room.you);
    if (!me) return;
    const host = me.isHost;
    const players = room.members.filter(m => !m.spectator && m.online);
    const votes = players.filter(m => m.hasVoted).length;
    const anyVotes = room.members.some(m => m.hasVoted);
    const result = room.history.find(r => r.number === room.round);
    const previousFocus = document.activeElement?.dataset?.focus;
    app.innerHTML = `<div class="workspace session-workspace">
      <div class="workspace-body">
        <header class="workspace-header session-header">
          ${brand()}
          <div class="header-actions">
            <span class="connection-status ${connected ? '' : 'offline'}"><span class="status-dot"></span>${connected ? 'Connected' : 'Reconnecting'}</span>
            ${!connected ? '<button class="button small secondary" data-action="reconnect">Reconnect</button>' : ''}
            <button class="button small secondary" data-action="invite">${icon('link')} <span>Invite team</span></button>
            <button class="icon-button" data-action="help" aria-label="How to play">${icon('help')}</button>
            <button class="icon-button" data-action="leave" aria-label="Leave session" title="Leave session">${icon('exit')}</button>
          </div>
        </header>
        <main class="room-main">
          <div class="room-title-row">
            <div><h1>${esc(room.name)}</h1><div class="session-identity">${esc(me.name)} · ${host ? 'Host' : me.spectator ? 'Spectator' : 'Player'} <span>Round ${room.round}</span></div></div>
            <div class="room-id"><span>SESSION ID</span><button class="code-button" data-action="copy-id" title="Copy session ID">${esc(room.id.slice(0,4))} ${esc(room.id.slice(4))} ${icon('link')}</button></div>
          </div>
          ${!connected ? '<div class="connection-banner" role="alert">Connection interrupted. Your last vote is saved. Voting resumes when you reconnect.</div>' : ''}
          <div class="room-grid">
            <div class="table-column">
              <section class="topic-bar">
                <div class="round-marker">${String(room.round).padStart(2,'0')}</div>
                <div class="topic-copy"><span class="eyebrow">CURRENT ROUND</span><h2>${esc(room.topic || `Round ${room.round}`)}</h2></div>
                ${host ? `<button class="text-button" data-action="topic" data-online ${room.revealed || anyVotes ? 'disabled' : ''} aria-label="Edit round topic">${icon('plus')} ${room.topic ? 'Edit topic' : 'Add topic'}</button>` : ''}
                <button class="timer-button" data-action="timer" ${!host ? 'disabled' : ''} aria-label="${host ? 'Set round timer' : 'Round timer'}">${icon('clock')} <span id="timer-label">${room.timerEndsAt ? '' : 'Timer'}</span></button>
              </section>
              <section class="deck-panel">
                <div class="section-heading"><div><h2>${me.spectator ? 'Spectator mode' : room.revealed ? 'Votes revealed' : 'Choose your estimate'}</h2><p>${me.spectator ? 'Watch the round, or join as a player to vote.' : room.revealed ? 'Discuss the estimates, then vote again or start the next round.' : 'Select a card. You can change it until the votes are revealed.'}</p></div><span class="deck-label">${esc(deckNames[room.deck])}</span></div>
                <div class="voting-deck" role="group" aria-label="Choose your estimate">
                  ${room.cards.map(value => `<button class="voting-card ${me.vote === value ? 'selected' : ''} ${value === '?' || value === '☕' ? 'special-card' : ''}" data-vote="${esc(value)}" data-focus="vote-${esc(value)}" data-online aria-pressed="${me.vote === value}" aria-label="${value === '☕' ? 'Need a break' : value === '?' ? 'Unsure' : `Estimate ${value}`}" ${room.revealed || me.spectator || !connected ? 'disabled' : ''}><span class="card-corner">${esc(value)}</span><strong>${esc(value)}</strong>${me.vote === value ? `<span class="selected-check">${icon('check')}</span>` : '<span class="card-foot">◇</span>'}</button>`).join('')}
                </div>
                <div class="deck-footer"><span>${icon(room.revealed ? 'eye' : 'lock')} ${me.spectator ? 'Spectator mode is on' : room.revealed ? 'All cards are now visible' : me.vote ? `You played ${esc(me.vote)}. Click again to clear.` : 'Your card stays hidden from the other players.'}</span><button class="text-button" data-action="role" data-online ${room.revealed ? 'disabled' : ''}>${me.spectator ? 'Join as player' : 'Watch as spectator'} ${icon(me.spectator ? 'plus' : 'eye')}</button></div>
              </section>
              <section class="table-panel ${room.revealed ? 'is-revealed' : ''}" aria-label="Planning table">
                <div class="table-panel-top"><h2>Players’ cards</h2><span class="table-state"><span class="status-dot"></span>${room.revealed ? 'REVEALED' : votes === players.length && votes > 0 ? 'EVERYONE IS READY' : 'VOTING'}</span></div>
                <div class="table-seats">
                  ${room.members.filter(m => !m.spectator && (m.online || m.hasVoted)).map(m => `<div class="seat"><div class="seat-card ${m.hasVoted ? 'played' : ''} ${room.revealed && m.hasVoted ? 'face-up' : ''} ${m.id === me.id && m.hasVoted && !room.revealed ? 'own-card' : ''}" aria-label="${esc(m.name)}: ${room.revealed || m.id === me.id ? esc(m.vote || 'no vote') : m.hasVoted ? 'voted, card hidden' : 'thinking'}">${room.revealed ? esc(m.vote || '—') : m.id === me.id && m.hasVoted ? esc(m.vote) : m.hasVoted ? icon('check') : '<span>· · ·</span>'}</div><span class="seat-name">${esc(m.name)}${m.id === me.id ? ' <small>(you)</small>' : ''}</span><span class="seat-status">${!m.online ? 'Away' : room.revealed ? m.hasVoted ? 'Revealed' : 'No vote' : m.hasVoted ? 'Ready' : 'Thinking'}</span></div>`).join('') || '<div class="empty-seats">No players yet. Invite your team or switch to player mode.</div>'}
                </div>
                <div class="table-bottom">
                  <span class="vote-progress">${icon('users')} <strong>${votes} of ${players.length}</strong> players ready</span>
                  ${host ? `<div class="table-controls">${room.revealed ? `<button class="text-button" data-action="reset" data-online>${icon('reset')} Vote again</button><button class="button primary" data-action="next" data-online>Next round ${icon('arrow')}</button>` : `<button class="button primary" data-action="reveal" data-online ${!anyVotes ? 'disabled' : ''}>${icon('eye')} Reveal cards</button>`}</div>` : `<span class="host-hint">${room.revealed ? 'Waiting for the host to start the next round' : 'Waiting for the host to reveal'}</span>`}
                </div>
              </section>
              ${room.revealed && result ? resultsPanel(result) : ''}
            </div>
            <aside class="details-column">
              <section class="team-panel"><div class="section-heading"><h2>Participants <span class="count-pill">${room.members.filter(m => m.online).length}</span></h2><button class="icon-button" data-action="invite" aria-label="Invite teammates">${icon('plus')}</button></div>
                <div class="team-list">${room.members.map((m,i) => `<div class="team-member ${!m.online ? 'away' : ''}"><div class="avatar color-${i%5}">${esc(initials(m.name))}<span class="presence ${m.online ? 'online' : ''}"></span></div><div class="member-info"><strong>${esc(m.name)} ${m.id === me.id ? '<small>(you)</small>' : ''}</strong><span>${m.isHost ? 'Host' : m.spectator ? 'Spectator' : !m.online ? 'Away' : 'Player'}</span></div><span class="member-status" title="${m.isHost ? 'Session host' : m.spectator ? 'Spectator' : m.hasVoted ? 'Ready' : 'Thinking'}">${m.isHost ? icon('crown') : m.spectator ? icon('eye') : m.hasVoted ? icon('check') : '<span class="thinking-dots">···</span>'}</span></div>`).join('')}</div>
              </section>
              ${host ? `<button class="session-settings" data-action="settings" data-online>${icon('settings')} Session settings ${icon('chevron')}</button>` : ''}
              <section class="history-panel"><div class="section-heading"><h2>Round history</h2><button class="icon-button" data-action="export" aria-label="Export round history as CSV" title="Export CSV" ${!room.history.length ? 'disabled' : ''}>${icon('download')}</button></div>
                ${room.history.length ? `<div class="history-list">${room.history.slice().reverse().map(r => `<button class="history-item" data-history="${r.number}"><span class="history-number">${String(r.number).padStart(2,'0')}</span><span class="history-title"><strong>${esc(r.topic || `Round ${r.number}`)}</strong><small>${r.distribution.reduce((sum,d)=>sum+d.count,0)} votes</small></span><span class="history-value">${esc(r.consensus || (r.average !== null ? formatNumber(r.average) : '—'))}</span></button>`).join('')}</div>` : '<p class="history-empty">Revealed rounds will appear here.</p>'}
              </section>
            </aside>
          </div>
        </main>
      </div>
    </div>`;
    document.querySelectorAll('[data-action]').forEach(button => button.onclick = () => action(button.dataset.action));
    document.querySelectorAll('[data-vote]').forEach(button => button.onclick = () => invoke('Vote', me.vote === button.dataset.vote ? null : button.dataset.vote));
    document.querySelectorAll('[data-history]').forEach(button => button.onclick = () => historyDialog(Number(button.dataset.history)));
    if (!connected || busy) setDisabled(true);
    tickTimer();
    if (previousFocus) [...document.querySelectorAll('[data-focus]')].find(element => element.dataset.focus === previousFocus)?.focus({ preventScroll: true });
  }

  function initials(name) { return name.split(/\s+/).slice(0,2).map(part => part[0]).join('').toUpperCase(); }
  function formatNumber(value) { return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
  function resultsPanel(result) {
    const largest = Math.max(...result.distribution.map(d=>d.count),1);
    return `<section class="results-panel"><div class="results-summary"><div class="eyebrow">THE BIG PICTURE</div><h2>${result.consensus ? 'On the same page.' : 'Room for a conversation.'}</h2><div class="result-stats"><div><strong>${result.average === null ? '—' : formatNumber(result.average)}</strong><span>Average</span></div><div><strong>${result.median === null ? '—' : formatNumber(result.median)}</strong><span>Median</span></div><div><strong>${result.distribution.reduce((sum,d)=>sum+d.count,0)}</strong><span>Votes</span></div></div><p>Average and median use numeric cards only.</p></div><div class="distribution" aria-label="Vote distribution">${result.distribution.map(d=>`<div class="distribution-row"><strong>${esc(d.value)}</strong><div class="distribution-track"><span class="distribution-fill width-${Math.max(1, Math.round(d.count/largest*20))}"></span></div><span>${d.count} ${d.count === 1 ? 'vote' : 'votes'}</span></div>`).join('')}</div></section>`;
  }

  async function action(name) {
    if (name === 'help') return howItWorks();
    if (name === 'invite') return inviteDialog();
    if (name === 'copy-id') return copy(room.id, 'Session ID copied');
    if (name === 'reveal') return invoke('Reveal');
    if (name === 'next') return invoke('NextRound', '');
    if (name === 'topic') return topicDialog(false);
    if (name === 'settings') return settingsDialog();
    if (name === 'timer') return timerDialog();
    if (name === 'export') return exportHistory();
    if (name === 'role') return invoke('SetSpectator', !room.members.find(m=>m.id === room.you).spectator);
    if (name === 'reset') return confirmDialog('Vote on this round again?', 'This clears all current cards and replaces this round’s saved result when you reveal again.', 'Start fresh', () => invoke('RestartRound'));
    if (name === 'leave') return confirmDialog('Leave the table?', 'The rest of your team can keep going. If you’re hosting, another connected teammate will become the host.', 'Leave session', async () => {
      if (connected) {
        const success = await invoke('Leave');
        if (!success) return false;
      }
      forget(`room:${room.id}`);
      joinedId = null;
      room = null;
      connected = false;
      await connection?.stop();
      history.pushState({}, '', '/');
      landing();
      return true;
    });
    if (name === 'reconnect') {
      if (connection.state !== signalR.HubConnectionState.Disconnected) return toast('Reconnecting. Give it a moment.');
      try { await join(joinedId, read(`room:${joinedId}`)); }
      catch (error) { toast(errorMessage(error), true); }
    }
  }
  function confirmDialog(title, message, label, callback) {
    showModal(title, `<p>${esc(message)}</p><div class="modal-actions"><button class="button secondary" id="cancel-confirm">Cancel</button><button class="button primary" id="accept-confirm">${esc(label)}</button></div>`);
    $('#cancel-confirm').onclick = () => modal.close();
    $('#accept-confirm').onclick = async event => { const button = event.currentTarget; button.disabled = true; if (await callback()) modal.close(); else button.disabled = false; };
  }
  function topicDialog(next) {
    showModal(next ? 'A fresh round. A fresh perspective.' : 'What’s on the table?', `<p>${next ? 'Give the next round a topic, or leave it open.' : 'Add a story title, ticket number, or whatever you’re working on.'}</p><form id="topic-form"><label for="topic">Round topic <span>optional · up to 180 characters</span></label><textarea id="topic" name="topic" maxlength="180" rows="3" placeholder="e.g. PROJ-42 · Simplify the checkout flow">${next ? '' : esc(room.topic)}</textarea><div class="modal-actions"><button type="submit" class="button primary" data-online>${next ? 'Start next round' : 'Save topic'} ${icon('arrow')}</button></div></form>`);
    $('#topic-form').onsubmit = async event => { event.preventDefault(); if (await invoke(next ? 'NextRound' : 'SetTopic', $('#topic').value)) modal.close(); };
  }
  function settingsDialog() {
    showModal('Session settings', `<p>Configure the deck and voting behavior for this session.</p><form id="settings-form"><label for="settings-name">Session name</label><input id="settings-name" value="${esc(room.name)}" maxlength="80" required><label for="settings-deck">Card deck</label><select id="settings-deck">${deckOptions(room.deck)}</select><p class="input-hint">Reset the round to change decks after anyone has voted.</p><label class="check-label"><input id="auto-reveal" type="checkbox" ${room.autoReveal ? 'checked' : ''}> Reveal automatically <span>Turn cards over when every online player has voted.</span></label><div class="modal-actions"><button type="submit" class="button primary" data-online>Save settings ${icon('check')}</button></div></form>`);
    $('#settings-form').onsubmit = async event => { event.preventDefault(); if (await invoke('UpdateSettings', { name: $('#settings-name').value, deck: $('#settings-deck').value, autoReveal: $('#auto-reveal').checked })) modal.close(); };
  }
  function timerDialog() {
    showModal('A little time to think.', `<p>Set a shared timer to keep the conversation moving. The host still decides when to reveal.</p><div class="timer-options">${[60,120,300].map(seconds=>`<button class="button secondary" data-seconds="${seconds}">${seconds/60} min</button>`).join('')}</div><button class="text-button" id="stop-timer">${icon('close')} Clear timer</button>`);
    document.querySelectorAll('[data-seconds]').forEach(button => button.onclick = async () => { if (await invoke('SetTimer', Number(button.dataset.seconds))) modal.close(); });
    $('#stop-timer').onclick = async () => { if (await invoke('SetTimer', 0)) modal.close(); };
  }
  function inviteDialog() {
    const url = `${location.origin}/room/${room.id}`;
    showModal('Invite teammates', `<p>Send this link to your team. They can join with just their name.</p><label for="invite-url">Your invite link</label><div class="copy-field"><input id="invite-url" readonly value="${esc(url)}"><button class="button primary" id="copy-invite">${icon('link')} Copy</button></div><div class="invite-id"><span>Or share the session ID</span><strong>${esc(room.id.slice(0,4))} ${esc(room.id.slice(4))}</strong></div>`);
    $('#copy-invite').onclick = () => copy(url, 'Invite link copied. Bring your team to the table.');
    $('#invite-url').onclick = event => event.target.select();
  }
  async function copy(value, message) {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(value);
      else {
        const field = document.createElement('textarea'); field.value = value; field.className = 'clipboard-helper'; (modal.open ? modal : document.body).append(field); field.select();
        const copied = document.execCommand('copy'); field.remove(); if (!copied) throw new Error('copy failed');
      }
      toast(message);
    } catch { toast('Select and copy the invite link in the invite dialog.', true); }
  }
  function historyDialog(number) {
    const result = room.history.find(r => r.number === number);
    if (!result) return;
    showModal(result.topic || `Round ${result.number}`, `<div class="history-detail-meta">ROUND ${result.number} · ${esc(deckNames[result.deck])} · ${esc(new Date(result.finishedAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}))}</div>${resultsPanel(result)}`);
  }
  function exportHistory() {
    // Prefix spreadsheet formula characters; quote and escape every cell.
    const cell = value => `"${String(value ?? '').replace(/^[=+@\-\t\r]/, "'$&").replace(/"/g, '""')}"`;
    const lines = [['Round','Topic','Deck','Revealed at (UTC)','Average','Median','Consensus','Votes']];
    for (const result of room.history) lines.push([result.number,result.topic,result.deck,result.finishedAt,result.average,result.median,result.consensus,result.distribution.map(d=>`${d.value}: ${d.count}`).join('; ')]);
    const blob = new Blob(['\uFEFF'+lines.map(line=>line.map(cell).join(',')).join('\r\n')], {type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `common-ground-${room.id}.csv`; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
    toast('Round history exported.');
  }
  function howItWorks() {
    showModal('How to play planning poker', `<div class="how-steps"><div><span>01</span><section><h3>Bring your team to the table.</h3><p>Create a session, then share its link or ID. No accounts needed.</p></section></div><div><span>02</span><section><h3>Think for yourself.</h3><p>Choose a card for the work in front of you. Higher numbers mean more effort or uncertainty. Use ? if you need more context, or ☕ for a break.</p></section></div><div><span>03</span><section><h3>Find your common ground.</h3><p>The host reveals everyone’s cards at once. Discuss the differences, vote again if needed, then move to the next story.</p></section></div></div><p class="input-hint">Sessions are kept in server memory for 12 hours after the last activity and clear on a server restart. Export your round history to keep a copy.</p>`);
  }
  function tickTimer() {
    const label = $('#timer-label');
    if (!label || !room?.timerEndsAt) return;
    const seconds = Math.max(0, Math.ceil((new Date(room.timerEndsAt).getTime() - Date.now())/1000));
    label.textContent = seconds === 0 ? 'Time’s up' : `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
    label.closest('button').classList.toggle('timer-expired', seconds === 0);
  }
  setInterval(tickTimer, 1000);
  async function route() {
    if (room || initialJoin) return;
    const match = location.pathname.match(/^\/room\/([a-f0-9]{8})\/?$/i);
    if (!match) { landing(); return; }
    const id = match[1].toUpperCase();
    const token = read(`room:${id}`);
    landing('join', id);
    if (token) {
      busy = true;
      const button = $('#start-form button[type="submit"]'); button.disabled = true;
      try { await join(id, token); }
      catch (error) { forget(`room:${id}`); if ($('#start-error')) $('#start-error').textContent = errorMessage(error); }
      finally { busy = false; if (room) renderRoom(); else button.disabled = false; }
    }
  }
  window.addEventListener('popstate', async () => {
    if (room && location.pathname !== `/room/${room.id}`) { history.pushState({}, '', `/room/${room.id}`); action('leave'); }
    else await route();
  });
  route();
})();
