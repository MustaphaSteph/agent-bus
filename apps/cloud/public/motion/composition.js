/* One paused, seek-safe composition. Live website playback is isolated in embed.js. */
gsap.registerPlugin(MotionPathPlugin);
const tl = gsap.timeline({ paused: true });
const phaseStarts = [0, 3, 6, 10, 14];
const phaseNames = ['connect', 'request', 'claim', 'review', 'memory'];
phaseStarts.forEach((start, i) => {
  tl.addLabel(phaseNames[i], start);
  if (!i) return;
  tl.set(`#heading-${i - 1}, #state-${i - 1}`, { opacity: 0 }, start);
  tl.fromTo(`#heading-${i}`, { opacity: 0, y: 9 }, { opacity: 1, y: 0, duration: .35, ease: 'power2.out', immediateRender: false }, start);
  tl.set(`#state-${i}`, { opacity: 1 }, start);
});

for (const [i, path] of [...document.querySelectorAll('.trace')].entries()) {
  const length = path.getTotalLength();
  tl.set(path, { strokeDasharray: length, strokeDashoffset: length, opacity: .6 }, 0);
  tl.to(path, { strokeDashoffset: 0, duration: .75, ease: 'power2.out' }, .15 + i * .12);
  tl.to(path, { opacity: 0, duration: .45 }, 2.3);
}
tl.fromTo('.secondary', { opacity: .45 }, { opacity: 1, stagger: .1, duration: .5 }, .6);
tl.fromTo('.record-progress', { scaleX: 0 }, { scaleX: 1, duration: 14.8, ease: 'none' }, 1.7);

function travel(target, route, start, duration, reverse = false) {
  const path = document.getElementById('path-' + route);
  tl.set(target, { opacity: 1 }, start);
  tl.fromTo(target, { x: 0, y: 0 }, {
    motionPath: { path: path.getAttribute('d'), start: reverse ? 1 : 0, end: reverse ? 0 : 1 },
    duration, ease: 'none', immediateRender: false,
  }, start);
  tl.set(target, { opacity: 0 }, start + duration);
  tl.to(`#trace-${route}`, { opacity: .8, duration: .15 }, start);
  tl.to(`#trace-${route}`, { opacity: .18, duration: .4 }, start + duration);
}
function emphasis(id, start, end) {
  tl.to(`#focus-${id}`, { opacity: 1, duration: .25 }, start);
  tl.to(`#focus-${id}`, { opacity: 0, duration: .35 }, end);
}
emphasis('claude', 3, 5.5);
travel('#packet', 'request', 3.35, 1.15);
tl.to('#record-request', { opacity: 1, duration: .2 }, 4.5);
tl.to('.hub-port span', { backgroundColor: '#00d4ff', stagger: .1, duration: .2 }, 4.5);
travel('#packet', 'claim', 6.1, 1.1);
emphasis('codex', 7.2, 10);
tl.to('#record-owner', { opacity: 1, duration: .25 }, 7.2);
tl.to('.task', { borderColor: '#2563eb', duration: .3 }, 7.2);
travel('#packet-review', 'claim', 10.1, .85, true);
travel('#packet-review', 'verify', 11.1, .95);
emphasis('kimi', 12.05, 14.7);
tl.to('.task', { borderColor: '#7c3aed', duration: .3 }, 12.05);
tl.to('#record-review', { opacity: 1, duration: .25 }, 12.4);
travel('#packet-memory', 'memory', 14.1, .85);
tl.to('#record-memory', { opacity: 1, duration: .3 }, 14.95);
tl.to('.task', { borderColor: '#00d4ff', duration: .3 }, 14.95);
travel('#packet-memory', 'return', 15.55, 1.1);

// The authored closing reset makes the website loop continuous, including reverse seeks.
tl.to('.trace, .record-fields span, .record-progress', { opacity: 0, duration: .35 }, 17.5);
tl.to('#heading-4, #state-4', { opacity: 0, duration: .2 }, 17.5);
tl.to('#heading-0, #state-0', { opacity: 1, duration: .3 }, 17.7);
tl.to('.task', { borderColor: '#303640', duration: .3 }, 17.7);
tl.to('.hub-port span', { backgroundColor: '#303640', duration: .3 }, 17.7);
window.__timelines = window.__timelines || {};
window.__timelines['agent-bus'] = tl;
tl.seek(0, false);
