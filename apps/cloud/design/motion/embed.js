(() => {
  if (new URLSearchParams(location.search).get('embed') !== '1') return;
  const root = document.querySelector('[data-composition-id]');
  const timeline = window.__timelines[root.dataset.compositionId];
  const duration = Number(root.dataset.duration);
  let time = 0;
  let playing = false;
  let frame = 0;
  let lastStamp = null;
  let lastEmit = 0;
  const emit = (type) => parent.postMessage({ source: 'agent-bus-motion', type, time, duration, playing }, location.origin);
  const fit = () => {
    const width = Number(root.dataset.width);
    const height = Number(root.dataset.height);
    const scale = Math.min(innerWidth / width, innerHeight / height);
    root.style.width = `${width}px`;
    root.style.height = `${height}px`;
    root.style.transform = `translate(${(innerWidth - width * scale) / 2}px, ${(innerHeight - height * scale) / 2}px) scale(${scale})`;
  };
  const tick = (stamp) => {
    if (!playing) return;
    if (lastStamp !== null) time = (time + Math.max(0, stamp - lastStamp) / 1000) % duration;
    lastStamp = stamp;
    timeline.seek(time, false);
    if (stamp - lastEmit >= 100) { emit('time'); lastEmit = stamp; }
    frame = requestAnimationFrame(tick);
  };
  const pause = () => {
    playing = false;
    cancelAnimationFrame(frame);
    lastStamp = null;
    emit('time');
  };
  addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.source !== parent) return;
    const message = event.data;
    if (!message || message.source !== 'agent-bus-landing') return;
    if (message.action === 'hello') {
      document.fonts.ready.then(() => emit('ready'));
      return;
    }
    if (!['play', 'pause', 'seek'].includes(message.action)) return;
    if (message.action === 'seek') {
      if (typeof message.time !== 'number' || !Number.isFinite(message.time)) return;
      time = Math.max(0, Math.min(duration, message.time));
      timeline.seek(time, false);
      lastStamp = null;
      emit('time');
    } else if (message.action === 'pause') pause();
    else if (!playing && !document.hidden) {
      playing = true;
      lastStamp = null;
      frame = requestAnimationFrame(tick);
      emit('time');
    }
  });
  addEventListener('resize', fit);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  fit();
  document.fonts.ready.then(() => emit('ready'));
})();
