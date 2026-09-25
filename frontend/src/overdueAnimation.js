// Particle motion copied from 渡劫.html; root isolates each rendered SVG.
export default function animateOverdue(root, hoverTarget) {
  const ns = 'http://www.w3.org/2000/svg';
  const back = root.getElementById('orbiting-diamonds-back');
  const front = root.getElementById('orbiting-diamonds-front');
  const bolt = root.querySelector('.mainBolt');
  const cycle = 4000;
  const gatherAt = cycle * .85397;
  const hitAt = cycle * .87831;
  const pace = 5855 / cycle;
  const scene = root.querySelector('svg');
  let startTime = performance.now();
  let boltAnimation;
  let frameId = null;
  let active = false;

  // 新粒子从脚下阵法补到最下层；每出现一层，已有粒子向上移动一档。
  const shiftDuration = 560;
  const layers = [
    {y: 219, rx: 82,  ry: 18, release: 0,    speed: 2 * Math.PI / 3400 * pace},
    {y: 184, rx: 102, ry: 23, release: 660,  speed: 2 * Math.PI / 3050 * pace},
    {y: 146, rx: 100, ry: 22, release: 1320, speed: 2 * Math.PI / 3500 * pace},
    {y: 105, rx: 86,  ry: 18, release: 1980, speed: 2 * Math.PI / 3200 * pace}
  ];
  const particles = [];

  for (let level = 0; level < layers.length; level++) {
    for (let index = 0; index < 14; index++) {
      const group = document.createElementNS(ns, 'g');
      const type = index === 3 || index === 10 ? 'diamond' : index % 4 === 0 ? 'fleck' : 'dust';
      const tail = document.createElementNS(ns, 'path');
      tail.setAttribute('d', 'M-9 1.2 Q-5 -2 -1.6 0');
      tail.setAttribute('fill', 'none');
      tail.setAttribute('stroke', '#9f55c3');
      tail.setAttribute('stroke-width', '.65');
      tail.setAttribute('stroke-linecap', 'round');
      tail.setAttribute('opacity', '.44');
      group.appendChild(tail);

      if (type === 'diamond') {
        const crystal = document.createElementNS(ns, 'path');
        const facet = document.createElementNS(ns, 'path');
        crystal.setAttribute('d', 'M0-4.2 L2.5 0 L0 4.2 L-2.5 0Z');
        crystal.setAttribute('fill', 'url(#diamondGrad)');
        crystal.setAttribute('stroke', '#efb8fa');
        crystal.setAttribute('stroke-width', '.6');
        facet.setAttribute('d', 'M0-3 L1 0 L0 3');
        facet.setAttribute('fill', 'none');
        facet.setAttribute('stroke', '#ffe1ff');
        facet.setAttribute('stroke-width', '.55');
        group.append(crystal, facet);
      } else if (type === 'fleck') {
        const fleck = document.createElementNS(ns, 'path');
        const fleckDust = document.createElementNS(ns, 'circle');
        const fleckGleam = document.createElementNS(ns, 'circle');
        fleck.setAttribute('d', 'M-2.1 0 L1.8 -.6');
        fleck.setAttribute('stroke', '#dda0ef');
        fleck.setAttribute('stroke-width', '.9');
        fleck.setAttribute('stroke-linecap', 'round');
        fleckDust.setAttribute('cx', '-4.1');
        fleckDust.setAttribute('cy', '1.9');
        fleckDust.setAttribute('r', '.52');
        fleckDust.setAttribute('fill', '#a857d0');
        fleckGleam.setAttribute('cx', '2.5');
        fleckGleam.setAttribute('cy', '-1.5');
        fleckGleam.setAttribute('r', '.42');
        fleckGleam.setAttribute('fill', '#f4d8ff');
        group.append(fleck, fleckDust, fleckGleam);
      } else {
        const haze = document.createElementNS(ns, 'circle');
        const mote = document.createElementNS(ns, 'circle');
        const gleam = document.createElementNS(ns, 'circle');
        const dustA = document.createElementNS(ns, 'circle');
        const dustB = document.createElementNS(ns, 'circle');
        const drift = (index % 5) - 2;
        haze.setAttribute('r', '2.8');
        haze.setAttribute('fill', '#a552ca');
        haze.setAttribute('opacity', '.24');
        mote.setAttribute('r', String(.82 + (index % 3) * .12));
        mote.setAttribute('fill', '#d990f0');
        gleam.setAttribute('r', '.34');
        gleam.setAttribute('fill', '#fff0ff');
        dustA.setAttribute('cx', String(-4.7 + drift * .35));
        dustA.setAttribute('cy', String(1.5 + drift * .25));
        dustA.setAttribute('r', '.48');
        dustA.setAttribute('fill', '#9d48c4');
        dustB.setAttribute('cx', String(3.3 + drift * .3));
        dustB.setAttribute('cy', String(-2 + drift * .2));
        dustB.setAttribute('r', '.4');
        dustB.setAttribute('fill', '#e9b5f7');
        group.append(haze, mote, gleam, dustA, dustB);
      }

      back.appendChild(group);
      particles.push({
        element: group,
        layer: layers[level],
        level,
        type,
        release: layers[level].release,
        angle: index * (2 * Math.PI / 14) + level * .37 + (Math.random() - .5) * .34,
        speed: layers[level].speed * (.88 + Math.random() * .24),
        bob: Math.random() * Math.PI * 2,
        size: .9 + Math.random() * .25
      });
    }
  }

  const cycleAnimationNames = new Set([
    'pulse', 'energy', 'preArc', 'cornerFlash', 'boltAnim', 'impactAnim',
    'wave1', 'wave2', 'flash', 'spark', 'eyeBreath', 'irisCharge',
    'shake', 'burn', 'shockFace', 'zapHair', 'smoke', 'residual'
  ]);
  let lastLeave = -Infinity;

  function onEnter() {
    if (active) return;
    const now = performance.now();
    if (now - lastLeave >= 1700) {
      startTime = now;
      if (scene.getAnimations) {
        for (const animation of scene.getAnimations({ subtree: true })) {
          if (cycleAnimationNames.has(animation.animationName)) animation.currentTime = 0;
        }
      }
      boltAnimation = undefined;
    }
    active = true;
    scene.classList.add('hover-active');
    frameId = requestAnimationFrame(frame);
  }

  function onLeave() {
    if (!active) return;
    lastLeave = performance.now();
    active = false;
    scene.classList.remove('hover-active');
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
  }

  hoverTarget.addEventListener('pointerenter', onEnter);
  hoverTarget.addEventListener('pointerleave', onLeave);

  function spiralPoint(particle, time) {
    const elapsed = Math.max(0, time - particle.release);
    let newest = 0;
    for (let level = 1; level < layers.length && time >= layers[level].release; level++) newest = level;
    const slot = newest - particle.level;
    const from = layers[Math.max(0, slot - 1)];
    const to = layers[slot];
    const t = Math.min(1, (time - layers[newest].release) / shiftDuration);
    const glide = t * t * (3 - 2 * t);
    const angle = particle.angle + elapsed * particle.speed;
    const radiusX = from.rx + (to.rx - from.rx) * glide;
    const radiusY = from.ry + (to.ry - from.ry) * glide;
    const centerY = from.y + (to.y - from.y) * glide;
    const depth = (Math.sin(angle) + 1) / 2;
    return {
      x: 120 + radiusX * Math.cos(angle),
      y: centerY + radiusY * Math.sin(angle) + 1.6 * Math.sin(elapsed * .006 * pace + particle.bob),
      angle: Math.atan2(radiusY * Math.cos(angle), -radiusX * Math.sin(angle)) * 180 / Math.PI,
      scale: particle.size * (.65 + .3 * depth),
      opacity: (.55 + .42 * depth) * Math.min(1, elapsed / 160),
      frontHalf: Math.sin(angle) >= 0
    };
  }

  function frame(now) {
    if (!boltAnimation && bolt.getAnimations) {
      boltAnimation = bolt.getAnimations().find(animation => animation.animationName === 'boltAnim');
    }
    const cssTime = boltAnimation && boltAnimation.currentTime;
    const phase = ((typeof cssTime === 'number' ? cssTime : now - startTime) % cycle + cycle) % cycle;

    for (const particle of particles) {
      if (phase < particle.release || phase > hitAt) {
        particle.element.setAttribute('opacity', '0');
        continue;
      }

      let point;
      if (phase < gatherAt) {
        point = spiralPoint(particle, phase);
      } else {
        // 四层全部形成后，才让所有粒子同时离轨并冲向原有受击点。
        const from = spiralPoint(particle, gatherAt);
        const progress = Math.pow((phase - gatherAt) / (hitAt - gatherAt), 1.3);
        point = {
          x: from.x + (120 - from.x) * progress,
          y: from.y + (260 - from.y) * progress,
          angle: Math.atan2(260 - from.y, 120 - from.x) * 180 / Math.PI,
          scale: from.scale * (1 - .45 * progress),
          opacity: 1,
          frontHalf: true
        };
      }

      const parent = point.frontHalf ? front : back;
      if (particle.element.parentNode !== parent) parent.appendChild(particle.element);
      particle.element.setAttribute('transform',
        `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)}) rotate(${point.angle.toFixed(1)}) scale(${point.scale.toFixed(2)})`);
      particle.element.setAttribute('opacity', point.opacity.toFixed(2));
    }
    if (active) frameId = requestAnimationFrame(frame);
  }
  return () => {
    onLeave();
    hoverTarget.removeEventListener('pointerenter', onEnter);
    hoverTarget.removeEventListener('pointerleave', onLeave);
  };
}
