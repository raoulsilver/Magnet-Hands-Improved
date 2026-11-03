let handpose;
let video;
let hands = [];
let particles = [];

// --- text interaction state ---
let textLayer;          // offscreen buffer used to rasterise the phrase
let currentPhrase = "";
let releaseTimer = null;
const HOLD_MS = 6000;   // how long particles hold the letters
const PARTICLE_COUNT = 1500;

function preload() {
  handpose = ml5.handPose();
}

function setup() {
  let cnv = createCanvas(640, 480);
  cnv.parent("canvas-holder");
  pixelDensity(1);
  textLayer = createGraphics(width, height);
  textLayer.pixelDensity(1);
  setupTextInput();

  video = createCapture(VIDEO);
  video.size(width, height);
  video.hide();
  setupStatus();

  handpose.detectStart(video, gotHands);

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push({
      x: random(width),
      y: random(height),
      speedX: 0,
      speedY: 0,
      size: random(1, 3),
      tx: null,          // text target (null = free-roaming)
      ty: null,
      delay: 0,          // frames to wait before heading to target (staggered, smoother)
      glow: 0            // 0..1 colour blend toward the "text" tint
    });
  }
}

// finger joint chains for drawing a glowing hand skeleton
const FINGERS = ["thumb", "index_finger", "middle_finger", "ring_finger", "pinky_finger"];
const JOINTS = {
  thumb: ["wrist", "thumb_cmc", "thumb_mcp", "thumb_ip", "thumb_tip"],
  index_finger: ["wrist", "index_finger_mcp", "index_finger_pip", "index_finger_dip", "index_finger_tip"],
  middle_finger: ["wrist", "middle_finger_mcp", "middle_finger_pip", "middle_finger_dip", "middle_finger_tip"],
  ring_finger: ["wrist", "ring_finger_mcp", "ring_finger_pip", "ring_finger_dip", "ring_finger_tip"],
  pinky_finger: ["wrist", "pinky_finger_mcp", "pinky_finger_pip", "pinky_finger_dip", "pinky_finger_tip"]
};
let pinchPrev = [];   // was each hand pinching last frame?
let rings = [];       // expanding shockwave rings {x, y, r, a}

function draw() {
  push();
  translate(width, 0);
  scale(-1, 1);

  image(video, 0, 0, width, height);
  noStroke();
  fill(0, 0, 0, 175);
  rect(0, 0, width, height);

  // --- hand analysis, once per frame ---
  let handCenters = [];   // palm repellers
  let tips = [];          // fingertip repellers
  let pinches = [];       // pinch attractors (thumb + index together)
  pinchPrev.length = min(pinchPrev.length, hands.length);
  for (let j = 0; j < hands.length; j++) {
    let hand = hands[j];
    handCenters.push({
      x: (hand.wrist.x + hand.index_finger_mcp.x + hand.pinky_finger_mcp.x) / 3,
      y: (hand.wrist.y + hand.index_finger_mcp.y + hand.pinky_finger_mcp.y) / 3
    });
    for (let f of FINGERS) tips.push(hand[f + "_tip"]);

    let pinching = dist(hand.thumb_tip.x, hand.thumb_tip.y, hand.index_finger_tip.x, hand.index_finger_tip.y) < 35;
    let pc = { x: (hand.thumb_tip.x + hand.index_finger_tip.x) / 2, y: (hand.thumb_tip.y + hand.index_finger_tip.y) / 2 };
    pinches.push(pinching ? pc : null);
    // letting go of a pinch fires a shockwave
    if (pinchPrev[j] && !pinching) {
      rings.push({ x: pinchPrev[j].x, y: pinchPrev[j].y, r: 10, a: 255 });
      for (let p of particles) {
        let dx = p.x - pinchPrev[j].x, dy = p.y - pinchPrev[j].y;
        let d = sqrt(dx * dx + dy * dy) + 0.01;
        if (d < 280) {
          let k = (1 - d / 280) * 14;
          p.speedX += (dx / d) * k;
          p.speedY += (dy / d) * k;
        }
      }
    }
    pinchPrev[j] = pinching ? pc : null;
  }

  // additive blending makes overlapping particles bloom like neon light
  drawingContext.globalCompositeOperation = "lighter";
  colorMode(HSB, 360, 100, 100, 255);

  for (let i = 0; i < particles.length; i++) {
    let particle = particles[i];

    // palm repulsion (original behaviour)
    for (let j = 0; j < handCenters.length; j++) {
      let handX = handCenters[j].x;
      let handY = handCenters[j].y;
      let distanceX = particle.x - handX;
      let distanceY = particle.y - handY;
      let distance = dist(particle.x, particle.y, handX, handY);

      if (distance < 120 && distance > 0) {
        let strength = (1 - distance / 120) * 3;

        particle.speedX += (distanceX / distance) * strength;
        particle.speedY += (distanceY / distance) * strength;
      }
    }

    // fingertips each flick nearby particles
    for (let t = 0; t < tips.length; t++) {
      let dx = particle.x - tips[t].x, dy = particle.y - tips[t].y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 2500 && d2 > 0) {
        let d = sqrt(d2);
        let k = (1 - d / 50) * 1.2;
        particle.speedX += (dx / d) * k;
        particle.speedY += (dy / d) * k;
      }
    }

    // pinch = tiny black hole: pull in + swirl around it
    for (let j = 0; j < pinches.length; j++) {
      let pc = pinches[j];
      if (!pc) continue;
      let dx = pc.x - particle.x, dy = pc.y - particle.y;
      let d = sqrt(dx * dx + dy * dy);
      if (d < 260 && d > 1) {
        let k = (1 - d / 260);
        particle.speedX += (dx / d) * k * 1.4 + (-dy / d) * k * 1.1;
        particle.speedY += (dy / d) * k * 1.4 + (dx / d) * k * 1.1;
      }
    }

    let hasTarget = particle.tx !== null;
    if (hasTarget) {
      // spring toward the letter shape (after a small staggered delay)
      if (particle.delay > 0) {
        particle.delay--;
      } else {
        particle.speedX += (particle.tx - particle.x) * 0.02;
        particle.speedY += (particle.ty - particle.y) * 0.02;
      }
    }

    particle.x += particle.speedX;
    particle.y += particle.speedY;
    let damping = hasTarget ? 0.88 : 0.97;
    particle.speedX *= damping;
    particle.speedY *= damping;

    // bounce when they hit a wall
    if (particle.x < 0 || particle.x > width) {
      particle.speedX *= -1;
      particle.x = constrain(particle.x, 0, width);
    }

    if (particle.y < 0 || particle.y > height) {
      particle.speedY *= -1;
      particle.y = constrain(particle.y, 0, height);
    }

    // ease the tint toward/away from the text colour
    particle.glow += ((hasTarget ? 1 : 0) - particle.glow) * 0.05;

    // calm = pale ice, fast = saturated rainbow that drifts with time and position
    let speed = sqrt(particle.speedX * particle.speedX + particle.speedY * particle.speedY);
    let heat = constrain(speed / 5, 0, 1);
    let hue = (frameCount * 0.8 + particle.x * 0.25 + particle.y * 0.15) % 360;
    hue = lerp(hue, 205, particle.glow * (1 - heat));
    let sat = max(8 + particle.glow * 30, heat * 85);
    let col = color(hue, sat, 100, 200);

    if (speed > 1) {
      stroke(hue, sat, 100, 60 + 120 * heat);
      strokeWeight(particle.size * 0.8);
      line(particle.x, particle.y, particle.x - particle.speedX * 3, particle.y - particle.speedY * 3);
      noStroke();
    }
    fill(col);
    circle(particle.x, particle.y, particle.size * (1 + heat * 0.8));
    // soft halo
    fill(hue, sat, 100, 18 + 30 * heat);
    circle(particle.x, particle.y, particle.size * 4);
  }

  // --- glowing hand skeleton ---
  for (let j = 0; j < hands.length; j++) {
    let hand = hands[j];
    for (let fi = 0; fi < FINGERS.length; fi++) {
      let chain = JOINTS[FINGERS[fi]];
      let h = (fi * 60 + frameCount * 1.5) % 360;
      stroke(h, 60, 100, 90);
      strokeWeight(2);
      noFill();
      beginShape();
      for (let name of chain) vertex(hand[name].x, hand[name].y);
      endShape();
      noStroke();
      fill(h, 40, 100, 200);
      circle(hand[chain[4]].x, hand[chain[4]].y, 7);
    }
  }

  // --- pinch orbs + palm aura ---
  let pulse = 1 + 0.08 * sin(frameCount * 0.1);
  for (let c of handCenters) {
    for (let k = 4; k >= 1; k--) {
      fill(210, 50, 100, 8);
      circle(c.x, c.y, 60 * k * pulse);
    }
  }
  for (let pc of pinches) {
    if (!pc) continue;
    for (let k = 5; k >= 1; k--) {
      fill((frameCount * 4) % 360, 70, 100, 25);
      circle(pc.x, pc.y, 14 * k * pulse);
    }
  }

  // --- shockwave rings ---
  for (let i = rings.length - 1; i >= 0; i--) {
    let ring = rings[i];
    ring.r += 9;
    ring.a *= 0.93;
    noFill();
    stroke(190, 50, 100, ring.a);
    strokeWeight(3);
    circle(ring.x, ring.y, ring.r * 2);
    if (ring.a < 5) rings.splice(i, 1);
  }

  drawingContext.globalCompositeOperation = "source-over";
  colorMode(RGB, 255);
  pop();
}

function gotHands(results) {
  hands = results;
}

// ---------- HTML input -> particles ----------

function setupTextInput() {
  const form = document.getElementById("thought-form");
  const input = document.getElementById("thought-input");

  // Enter inside the HTML input (form submit) paints the thought on the canvas
  input.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      event.preventDefault();
      const phrase = input.value.trim();
      if (phrase) {
        paintThought(phrase);
        input.value = "";
      }
    }
  });
  form.addEventListener("submit", function (e) { e.preventDefault(); });
}

function paintThought(phrase) {
  currentPhrase = phrase;
  // a ring flashes out from the centre and scatters particles before they gather
  rings.push({ x: width / 2, y: height / 2, r: 10, a: 255 });
  for (let p of particles) {
    let dx = p.x - width / 2, dy = p.y - height / 2;
    let d = sqrt(dx * dx + dy * dy) + 0.01;
    p.speedX += (dx / d) * 6;
    p.speedY += (dy / d) * 6;
  }
  clearTimeout(releaseTimer);

  // Rasterise the phrase, shrinking the font until it fits the canvas
  textLayer.clear();
  textLayer.background(0);
  textLayer.fill(255);
  textLayer.noStroke();
  textLayer.textAlign(CENTER, CENTER);
  textLayer.textStyle(BOLD);
  textLayer.textFont("Helvetica, Arial, sans-serif");
  let size = 160;
  textLayer.textSize(size);
  let w = textLayer.textWidth(phrase);
  size = constrain(size * (width * 0.86) / w, 18, 160);
  textLayer.textSize(size);
  textLayer.text(phrase, width / 2, height / 2);
  textLayer.loadPixels();

  // Sample lit pixels on a grid (finer grid for small text)
  let step = size > 90 ? 5 : size > 50 ? 4 : 3;
  let points = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (textLayer.pixels[(y * width + x) * 4] > 128) {
        // draw() is mirrored, so flip x so the text reads correctly on screen
        points.push({ x: width - x, y: y });
      }
    }
  }
  if (points.length === 0) return;

  // shuffle points, cap to the particle count
  for (let i = points.length - 1; i > 0; i--) {
    let j = floor(random(i + 1));
    [points[i], points[j]] = [points[j], points[i]];
  }
  points.length = min(points.length, particles.length);

  // Assign nearest-first would be costly; random pairing gives a pleasing swarm effect
  let order = particles.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    let j = floor(random(i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (let i = 0; i < particles.length; i++) {
    let p = particles[order[i]];
    if (i < points.length) {
      p.tx = points[i].x + random(-0.8, 0.8);
      p.ty = points[i].y + random(-0.8, 0.8);
      p.delay = floor(random(0, 25));
    } else {
      p.tx = null; // leftover particles keep drifting around the letters
      p.ty = null;
    }
  }

  releaseTimer = setTimeout(releaseThought, HOLD_MS);
}

// Let the letters dissolve back into the normal magnet behaviour
function releaseThought() {
  for (let p of particles) {
    if (p.tx !== null) {
      let a = random(TWO_PI);
      let f = random(1, 5);
      p.speedX += cos(a) * f;
      p.speedY += sin(a) * f;
    }
    p.tx = null;
    p.ty = null;
  }
  currentPhrase = "";
}

// ---------- camera status ----------

function setupStatus() {
  const status = document.getElementById("status");
  if (location.protocol === "file:") {
    status.textContent = "Open this page through a local server (e.g. VS Code Live Server) so the camera can start.";
    return;
  }
  status.textContent = "Allow camera access to begin";
  video.elt.addEventListener("loadeddata", function () {
    status.textContent = "Wave to push · pinch to make a black hole · let go to explode";
    setTimeout(() => status.classList.add("hidden"), 3500);
  });
}