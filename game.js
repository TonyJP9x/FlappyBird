/**
 * Flappy Bird Clone
 * Pure HTML5 Canvas 2D — no images, no libraries, no build tools.
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  const CANVAS_WIDTH  = 480;
  const CANVAS_HEIGHT = 640;

  const GROUND_HEIGHT = 80;
  const GROUND_Y      = CANVAS_HEIGHT - GROUND_HEIGHT; // y where ground starts

  const GRAVITY       = 1500;  // px/s²
  const FLAP_VELOCITY = -420;  // px/s  (negative = upward)

  const BIRD_X        = 120;
  const BIRD_START_Y  = 320;
  const BIRD_RADIUS   = 18;
  const BIRD_HITBOX   = BIRD_RADIUS - 4; // 14 px effective half-size

  const PIPE_WIDTH    = 60;
  const PIPE_SPEED    = 200; // px/s
  const PIPE_GAP      = 160; // vertical opening between top and bottom pipe
  const PIPE_SPAWN_INTERVAL = 280; // px of scroll between pipe pairs

  // Gap centre is chosen randomly within this band (in canvas coordinates)
  const PIPE_GAP_MIN_CENTRE = 160;
  const PIPE_GAP_MAX_CENTRE = GROUND_Y - 160;

  // Game states
  const STATE_IDLE    = 'IDLE';
  const STATE_PLAYING = 'PLAYING';
  const STATE_DEAD    = 'DEAD';

  // Colours
  const COLOR_SKY       = '#4EC0CA';
  const COLOR_BIRD      = '#F6D935';
  const COLOR_BIRD_EYE  = '#000';
  const COLOR_BIRD_BEAK = '#FF8C00';
  const COLOR_PIPE      = '#228B22';
  const COLOR_PIPE_EDGE = '#1A6B1A';
  const COLOR_GROUND    = '#8B5E3C';
  const COLOR_GROUND_TOP= '#A0522D';
  const COLOR_SCORE     = '#FFF';
  const COLOR_OVERLAY   = 'rgba(0,0,0,0.45)';

  // ---------------------------------------------------------------------------
  // Canvas / context
  // ---------------------------------------------------------------------------

  const canvas = document.getElementById('gameCanvas');
  const ctx    = canvas.getContext('2d');

  // ---------------------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------------------

  let state;
  let score;
  let bird;
  let pipes;
  let scrolledSinceLastPipe; // tracks px scrolled to know when to spawn next pipe

  // BUG 3 fix: declare lastTimestamp here so resetGame() can clear it
  let lastTimestamp = null;

  // BUG 1 fix: track the active rAF handle so we can cancel it on restart
  let rafId = null;

  // BUG 4 fix: prevent a single mobile tap from firing both touchstart + mousedown
  let lastInputWasTouch = false;

  // ---------------------------------------------------------------------------
  // Top-5 leaderboard — persisted in localStorage
  // ---------------------------------------------------------------------------

  const STORAGE_KEY_TOP_SCORES = 'flappyTopScores';
  const TOP_SCORES_LIMIT       = 5;

  // Sorted descending (highest first); at most TOP_SCORES_LIMIT entries
  let topScores = [];

  // Load existing data at startup; silently ignore any storage errors
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TOP_SCORES);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        topScores = parsed;
      }
    }
  } catch (_) {
    // localStorage blocked or JSON malformed — proceed with empty leaderboard
  }

  function saveScore(finalScore) {
    // Insert, sort descending, keep only the top N
    topScores.push(finalScore);
    topScores.sort(function (a, b) { return b - a; });
    if (topScores.length > TOP_SCORES_LIMIT) {
      topScores = topScores.slice(0, TOP_SCORES_LIMIT);
    }

    // Persist — ignore write errors (private/incognito mode, quota exceeded, etc.)
    try {
      localStorage.setItem(STORAGE_KEY_TOP_SCORES, JSON.stringify(topScores));
    } catch (_) {
      // Storage unavailable — continue without persisting
    }
  }

  function resetGame() {
    state = STATE_IDLE;
    score = 0;

    bird = {
      x:  BIRD_X,
      y:  BIRD_START_Y,
      vy: 0,       // vertical velocity px/s
      rotation: 0, // visual tilt in radians
    };

    pipes = [];
    scrolledSinceLastPipe = 0;

    // BUG 3 fix: clear lastTimestamp so the first frame after restart gets dt=0
    lastTimestamp = null;
  }

  // ---------------------------------------------------------------------------
  // Pipe factory
  // ---------------------------------------------------------------------------

  function createPipe(x) {
    const gapCentre = PIPE_GAP_MIN_CENTRE +
      Math.random() * (PIPE_GAP_MAX_CENTRE - PIPE_GAP_MIN_CENTRE);

    return {
      x,
      gapCentre,
      scored: false,
    };
  }

  // Derived geometry helpers so we never recompute in multiple places
  function pipeTopRect(pipe) {
    return {
      x: pipe.x,
      y: 0,
      w: PIPE_WIDTH,
      h: pipe.gapCentre - PIPE_GAP / 2,
    };
  }

  function pipeBottomRect(pipe) {
    const topEdge = pipe.gapCentre + PIPE_GAP / 2;
    return {
      x: pipe.x,
      y: topEdge,
      w: PIPE_WIDTH,
      h: GROUND_Y - topEdge,
    };
  }

  // ---------------------------------------------------------------------------
  // Collision detection — AABB
  // ---------------------------------------------------------------------------

  function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw &&
           ax + aw > bx &&
           ay < by + bh &&
           ay + ah > by;
  }

  function birdHitRect(rx, ry, rw, rh) {
    // Bird hitbox: square centred on bird position
    const hx = bird.x - BIRD_HITBOX;
    const hy = bird.y - BIRD_HITBOX;
    const hs = BIRD_HITBOX * 2;
    return rectsOverlap(hx, hy, hs, hs, rx, ry, rw, rh);
  }

  function checkCollisions() {
    // Ceiling
    if (bird.y - BIRD_HITBOX <= 0) return true;

    // Ground
    if (bird.y + BIRD_HITBOX >= GROUND_Y) return true;

    // Pipes
    for (const pipe of pipes) {
      const top = pipeTopRect(pipe);
      const bot = pipeBottomRect(pipe);
      if (birdHitRect(top.x, top.y, top.w, top.h)) return true;
      if (birdHitRect(bot.x, bot.y, bot.w, bot.h)) return true;
    }

    return false;
  }

  // ---------------------------------------------------------------------------
  // Input handling
  // ---------------------------------------------------------------------------

  function handleFlap() {
    if (state === STATE_IDLE) {
      state = STATE_PLAYING;
      bird.vy = FLAP_VELOCITY;
    } else if (state === STATE_PLAYING) {
      bird.vy = FLAP_VELOCITY;
    } else if (state === STATE_DEAD) {
      // BUG 1 fix: cancel the currently running loop before starting a fresh one
      cancelAnimationFrame(rafId);
      resetGame();
      state = STATE_PLAYING;
      bird.vy = FLAP_VELOCITY;
      lastTimestamp = null;
      rafId = requestAnimationFrame(loop);
    }
  }

  // Advisory fix: ignore key-repeat events so holding Space doesn't spam flaps
  document.addEventListener('keydown', function (e) {
    if (e.code === 'Space' && !e.repeat) {
      e.preventDefault();
      handleFlap();
    }
  });

  // Advisory fix: ignore right-clicks; BUG 4 fix: skip if touch already handled it
  canvas.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    if (lastInputWasTouch) { lastInputWasTouch = false; return; }
    e.preventDefault();
    handleFlap();
  });

  // BUG 4 fix: set flag so the subsequent mousedown is suppressed
  canvas.addEventListener('touchstart', function (e) {
    e.preventDefault();
    lastInputWasTouch = true;
    handleFlap();
  }, { passive: false });

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  function update(dt) {
    if (state !== STATE_PLAYING) return;

    // --- Bird physics ---
    bird.vy += GRAVITY * dt;
    bird.y  += bird.vy * dt;

    // BUG 2 fix: clamp uses BIRD_HITBOX (14) to match the death-collision threshold,
    // so the bird can actually reach y - BIRD_HITBOX <= 0 and trigger ceiling death.
    if (bird.y - BIRD_HITBOX <= 0) {
      bird.y  = BIRD_HITBOX;
      bird.vy = 0;
    }

    // Visual rotation: nose-dive when falling, level/up when flapping
    // Target rotation mapped from velocity: -420 → -25°, +800 → +90°
    const targetRot = Math.min(Math.PI / 2, bird.vy / 600 * (Math.PI / 2));
    bird.rotation += (targetRot - bird.rotation) * Math.min(1, dt * 10);

    // --- Scroll pipes ---
    const dx = PIPE_SPEED * dt;
    scrolledSinceLastPipe += dx;

    for (const pipe of pipes) {
      pipe.x -= dx;
    }

    // Spawn new pipe when enough distance has scrolled
    if (scrolledSinceLastPipe >= PIPE_SPAWN_INTERVAL) {
      scrolledSinceLastPipe -= PIPE_SPAWN_INTERVAL;
      pipes.push(createPipe(CANVAS_WIDTH + PIPE_WIDTH));
    }

    // Remove off-screen pipes
    pipes = pipes.filter(pipe => pipe.x + PIPE_WIDTH > 0);

    // --- Scoring ---
    for (const pipe of pipes) {
      if (!pipe.scored && bird.x > pipe.x + PIPE_WIDTH) {
        pipe.scored = true;
        score += 1;
      }
    }

    // --- Collision ---
    if (checkCollisions()) {
      state = STATE_DEAD;
      saveScore(score);
    }
  }

  // ---------------------------------------------------------------------------
  // Draw helpers
  // ---------------------------------------------------------------------------

  function drawBackground() {
    ctx.fillStyle = COLOR_SKY;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }

  function drawGround() {
    // Main ground strip
    ctx.fillStyle = COLOR_GROUND;
    ctx.fillRect(0, GROUND_Y, CANVAS_WIDTH, GROUND_HEIGHT);

    // Slightly lighter top edge for contrast
    ctx.fillStyle = COLOR_GROUND_TOP;
    ctx.fillRect(0, GROUND_Y, CANVAS_WIDTH, 8);
  }

  function drawPipe(pipe) {
    const top = pipeTopRect(pipe);
    const bot = pipeBottomRect(pipe);
    const CAP_HEIGHT = 20;
    const CAP_OVERHANG = 6; // caps are slightly wider than pipe body

    // --- Top pipe ---
    if (top.h > 0) {
      // Pipe body
      ctx.fillStyle = COLOR_PIPE;
      ctx.fillRect(top.x, top.y, top.w, top.h);

      // Pipe cap (lip at the bottom of the top pipe)
      ctx.fillStyle = COLOR_PIPE_EDGE;
      ctx.fillRect(
        top.x - CAP_OVERHANG,
        top.y + top.h - CAP_HEIGHT,
        top.w + CAP_OVERHANG * 2,
        CAP_HEIGHT
      );

      // BUG 5 fix: only draw highlight when pipe body is taller than the cap;
      // otherwise top.h - CAP_HEIGHT is negative and fillRect renders garbage.
      if (top.h > CAP_HEIGHT) {
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fillRect(top.x + 6, top.y, 10, top.h - CAP_HEIGHT);
      }
    }

    // --- Bottom pipe ---
    if (bot.h > 0) {
      // Pipe body
      ctx.fillStyle = COLOR_PIPE;
      ctx.fillRect(bot.x, bot.y, bot.w, bot.h);

      // Pipe cap (lip at the top of the bottom pipe)
      ctx.fillStyle = COLOR_PIPE_EDGE;
      ctx.fillRect(
        bot.x - CAP_OVERHANG,
        bot.y,
        bot.w + CAP_OVERHANG * 2,
        CAP_HEIGHT
      );

      // BUG 5 fix: same guard for the bottom pipe highlight
      if (bot.h > CAP_HEIGHT) {
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fillRect(bot.x + 6, bot.y + CAP_HEIGHT, 10, bot.h - CAP_HEIGHT);
      }
    }
  }

  function drawBird() {
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate(bird.rotation);

    // Body
    ctx.beginPath();
    ctx.arc(0, 0, BIRD_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = COLOR_BIRD;
    ctx.fill();
    ctx.strokeStyle = '#D4A800';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Wing (simple ellipse on the left/bottom side)
    ctx.beginPath();
    ctx.ellipse(-6, 6, 8, 5, Math.PI / 6, 0, Math.PI * 2);
    ctx.fillStyle = '#E5C800';
    ctx.fill();

    // Eye (white sclera + dark pupil)
    ctx.beginPath();
    ctx.arc(8, -5, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#FFF';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(10, -5, 3, 0, Math.PI * 2);
    ctx.fillStyle = COLOR_BIRD_EYE;
    ctx.fill();

    // Beak
    ctx.beginPath();
    ctx.moveTo(14, -1);
    ctx.lineTo(22, 2);
    ctx.lineTo(14, 5);
    ctx.closePath();
    ctx.fillStyle = COLOR_BIRD_BEAK;
    ctx.fill();

    ctx.restore();
  }

  function drawScore() {
    ctx.fillStyle = COLOR_SCORE;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 3;
    ctx.font = 'bold 40px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.strokeText(String(score), CANVAS_WIDTH / 2, 24);
    ctx.fillText(String(score), CANVAS_WIDTH / 2, 24);
  }

  function drawIdleScreen() {
    // Dim overlay
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Title
    ctx.font = 'bold 52px Arial, sans-serif';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 4;
    ctx.strokeText('Flappy Bird', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 60);
    ctx.fillStyle = '#F6D935';
    ctx.fillText('Flappy Bird', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 60);

    // Prompt
    ctx.font = '22px Arial, sans-serif';
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 3;
    ctx.strokeText('Click or Press Space to Start', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 10);
    ctx.fillStyle = '#FFF';
    ctx.fillText('Click or Press Space to Start', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 10);

    // Best score subtitle — only shown once the player has completed at least one game
    if (topScores.length > 0) {
      ctx.font = '18px Arial, sans-serif';
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 2;
      ctx.strokeText('Best: ' + topScores[0], CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 46);
      ctx.fillStyle = '#F6D935';
      ctx.fillText('Best: ' + topScores[0], CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 46);
    }
  }

  // Draws a rounded rectangle path (no fill/stroke — caller decides style)
  function roundedRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y,     x + w, y + r,     r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x,     y + h, x,     y + h - r, r);
    ctx.lineTo(x,     y + r);
    ctx.arcTo(x,     y,     x + r, y,         r);
    ctx.closePath();
  }

  function drawDeadScreen() {
    // Semi-transparent dark overlay
    ctx.fillStyle = COLOR_OVERLAY;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // ---- "Game Over" heading — sits near the top ----
    const headingY = 90;
    ctx.font = 'bold 52px Arial, sans-serif';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 4;
    ctx.strokeText('Game Over', CANVAS_WIDTH / 2, headingY);
    ctx.fillStyle = '#FF4444';
    ctx.fillText('Game Over', CANVAS_WIDTH / 2, headingY);

    // ---- Final score ----
    const scoreY = headingY + 62;
    ctx.font = 'bold 36px Arial, sans-serif';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 4;
    ctx.strokeText('Score: ' + score, CANVAS_WIDTH / 2, scoreY);
    ctx.fillStyle = '#FFF';
    ctx.fillText('Score: ' + score, CANVAS_WIDTH / 2, scoreY);

    // ---- Leaderboard table ----
    // Layout constants
    const TABLE_ROW_H    = 30;  // height of each data row
    const TABLE_HEADER_H = 36;  // height of the "TOP SCORES" header row
    const TABLE_PAD_X    = 20;  // horizontal inner padding
    const TABLE_PAD_Y    = 10;  // vertical inner padding (top & bottom)
    const TABLE_W        = 260;
    const TABLE_X        = (CANVAS_WIDTH - TABLE_W) / 2;

    // Only render rows that exist
    const rowCount   = topScores.length;
    const tableH     = TABLE_HEADER_H + rowCount * TABLE_ROW_H + TABLE_PAD_Y * 2;

    // Place the table so it ends comfortably above the ground strip.
    // Reserve 40 px for the restart prompt below the table.
    const PROMPT_H   = 40;
    const TABLE_Y    = GROUND_Y - tableH - PROMPT_H - 12;

    if (rowCount > 0) {
      // --- Table background ---
      roundedRect(TABLE_X, TABLE_Y, TABLE_W, tableH, 10);
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // --- "TOP SCORES" header ---
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.font         = 'bold 16px Arial, sans-serif';
      ctx.fillStyle    = '#F6D935';
      ctx.fillText('TOP SCORES', CANVAS_WIDTH / 2, TABLE_Y + TABLE_PAD_Y + TABLE_HEADER_H / 2);

      // Thin separator line under header
      const sepY = TABLE_Y + TABLE_PAD_Y + TABLE_HEADER_H;
      ctx.beginPath();
      ctx.moveTo(TABLE_X + 12, sepY);
      ctx.lineTo(TABLE_X + TABLE_W - 12, sepY);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth   = 1;
      ctx.stroke();

      // --- Score rows ---
      // Find whether the current score appears in the leaderboard (first match)
      const highlightIndex = topScores.indexOf(score);

      const rankX  = TABLE_X + TABLE_PAD_X + 24;   // left edge for rank labels
      const valX   = TABLE_X + TABLE_W - TABLE_PAD_X; // right edge for score values

      for (let i = 0; i < rowCount; i++) {
        const rowY = sepY + i * TABLE_ROW_H;
        const midY = rowY + TABLE_ROW_H / 2;

        // Highlight the row that matches the current score (first occurrence only)
        if (i === highlightIndex) {
          // Gold highlight pill clipped to table corners on first/last row
          roundedRect(TABLE_X + 6, rowY + 3, TABLE_W - 12, TABLE_ROW_H - 6, 6);
          ctx.fillStyle = 'rgba(246,217,53,0.28)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(246,217,53,0.6)';
          ctx.lineWidth   = 1;
          ctx.stroke();
        }

        // Rank label  "#1", "#2", …
        ctx.textAlign    = 'left';
        ctx.textBaseline = 'middle';
        ctx.font         = (i === highlightIndex)
          ? 'bold 15px Arial, sans-serif'
          : '15px Arial, sans-serif';
        ctx.fillStyle    = (i === highlightIndex) ? '#F6D935' : 'rgba(255,255,255,0.75)';
        ctx.fillText('#' + (i + 1), rankX, midY);

        // Score value — right-aligned
        ctx.textAlign    = 'right';
        ctx.font         = (i === highlightIndex)
          ? 'bold 15px Arial, sans-serif'
          : '15px Arial, sans-serif';
        ctx.fillStyle    = (i === highlightIndex) ? '#F6D935' : '#FFF';
        ctx.fillText(String(topScores[i]), valX, midY);
      }
    }

    // ---- Restart prompt ----
    const promptY = GROUND_Y - PROMPT_H / 2 - 8;
    ctx.font         = '20px Arial, sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle  = 'rgba(0,0,0,0.5)';
    ctx.lineWidth    = 3;
    ctx.strokeText('Press Space or Click to Restart', CANVAS_WIDTH / 2, promptY);
    ctx.fillStyle    = '#FFF';
    ctx.fillText('Press Space or Click to Restart', CANVAS_WIDTH / 2, promptY);
  }

  function draw() {
    drawBackground();

    // Draw all pipes behind the bird
    for (const pipe of pipes) {
      drawPipe(pipe);
    }

    drawGround();
    drawBird();

    if (state === STATE_PLAYING || state === STATE_DEAD) {
      drawScore();
    }

    if (state === STATE_IDLE) {
      drawIdleScreen();
    }

    if (state === STATE_DEAD) {
      drawDeadScreen();
    }
  }

  // ---------------------------------------------------------------------------
  // Game loop
  // ---------------------------------------------------------------------------

  function loop(timestamp) {
    if (lastTimestamp === null) {
      lastTimestamp = timestamp;
    }

    // Delta time in seconds; capped at 100 ms to prevent spiral of death on tab
    // switch or when the browser pauses the tab.
    const dt = Math.min((timestamp - lastTimestamp) / 1000, 0.1);
    lastTimestamp = timestamp;

    update(dt);
    draw();

    // BUG 1 fix: store the handle so it can be cancelled on restart
    rafId = requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------------------

  resetGame();
  // BUG 1 fix: store the initial handle
  rafId = requestAnimationFrame(loop);

})();
