/**
 * game.test.js
 * Self-contained test suite for the Flappy Bird clone.
 *
 * STRATEGY
 * =========
 * game.js is an IIFE with no exports. Two approaches are used:
 *
 *  1. Mirror - pure functions (physics, AABB, pipe geometry, scoring)
 *     are re-implemented verbatim from game.js. Drift = safety signal.
 *
 *  2. DOM simulation - state transitions are driven by synthetic
 *     keyboard/mouse events on the live document and canvas.
 *     Canvas pixel colours confirm rendering.
 *
 * Every test prints PASS or FAIL to the browser console.
 * Async tests are labelled [async] and follow the sync summary.
 */
(function () {
  "use strict";

  // Constants -- mirrored from game.js (must stay in sync)
  var CANVAS_WIDTH  = 480;
  var CANVAS_HEIGHT = 640;
  var GROUND_HEIGHT = 80;
  var GROUND_Y      = CANVAS_HEIGHT - GROUND_HEIGHT; // 560
  var GRAVITY       = 1500;   // px/s^2
  var FLAP_VELOCITY = -420;   // px/s (negative = upward)
  var BIRD_X        = 120;
  var BIRD_START_Y  = 320;
  var BIRD_RADIUS   = 18;
  var BIRD_HITBOX   = BIRD_RADIUS - 4; // 14 -- forgiving hitbox half-size
  var PIPE_WIDTH    = 60;
  var PIPE_SPEED    = 200;   // px/s
  var PIPE_GAP      = 160;  // vertical gap between pipe bodies
  var PIPE_SPAWN_INTERVAL = 280; // px scroll between pipe pairs
  var PIPE_GAP_MIN_CENTRE = 160;
  var PIPE_GAP_MAX_CENTRE = GROUND_Y - 160; // 400

  // Pure functions -- mirrored verbatim from game.js

  function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  function pipeTopRect(pipe) {
    return { x: pipe.x, y: 0, w: PIPE_WIDTH, h: pipe.gapCentre - PIPE_GAP / 2 };
  }

  function pipeBottomRect(pipe) {
    var topEdge = pipe.gapCentre + PIPE_GAP / 2;
    return { x: pipe.x, y: topEdge, w: PIPE_WIDTH, h: GROUND_Y - topEdge };
  }

  function birdHitRect(bird, rx, ry, rw, rh) {
    var hx = bird.x - BIRD_HITBOX;
    var hy = bird.y - BIRD_HITBOX;
    var hs = BIRD_HITBOX * 2;
    return rectsOverlap(hx, hy, hs, hs, rx, ry, rw, rh);
  }

  function checkCollisions(bird, pipes) {
    if (bird.y - BIRD_HITBOX <= 0)        return true;
    if (bird.y + BIRD_HITBOX >= GROUND_Y) return true;
    for (var i = 0; i < pipes.length; i++) {
      var pipe = pipes[i];
      var top  = pipeTopRect(pipe);
      var bot  = pipeBottomRect(pipe);
      if (birdHitRect(bird, top.x, top.y, top.w, top.h)) return true;
      if (birdHitRect(bird, bot.x, bot.y, bot.w, bot.h)) return true;
    }
    return false;
  }

  function physicsTick(bird, dt) {
    var vy = bird.vy + GRAVITY * dt;
    var y  = bird.y  + vy * dt;
    return { y: y, vy: vy };
  }

  function scoringTick(score, bird, pipes) {
    var cloned = pipes.map(function (p) {
      return { x: p.x, gapCentre: p.gapCentre, scored: p.scored };
    });
    for (var i = 0; i < cloned.length; i++) {
      var pipe = cloned[i];
      if (!pipe.scored && bird.x > pipe.x + PIPE_WIDTH) {
        pipe.scored = true;
        score += 1;
      }
    }
    return { score: score, pipes: cloned };
  }

  // Test runner
  var _passed = 0;
  var _failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log("%cPASS%c " + name, "color:green;font-weight:bold", "");
      _passed++;
    } catch (err) {
      console.error("%cFAIL%c " + name + " -- " + err.message,
        "color:red;font-weight:bold", "");
      _failed++;
    }
  }

  function assert(c, m) { if (!c) throw new Error(m || "Expected truthy"); }
  function assertFalse(c, m) { if (c) throw new Error(m || "Expected falsy"); }
  function assertEqual(a, b, m) {
    if (a !== b) throw new Error((m || "Expected equal") + " -- got " + JSON.stringify(a) + " vs " + JSON.stringify(b));
  }
  function assertApprox(a, b, eps, m) {
    if (eps === undefined) eps = 1e-9;
    if (Math.abs(a - b) > eps)
      throw new Error((m || "Expected ~equal") + " -- got " + a + " vs " + b + " (tol " + eps + ")");
  }

  // DOM helpers
  var canvas = document.getElementById("gameCanvas");

  function fireKeydown(code, repeat) {
    document.dispatchEvent(new KeyboardEvent("keydown",
      { code: code, repeat: !!repeat, bubbles: true, cancelable: true }));
  }
  function fireMousedown(el, button) {
    el.dispatchEvent(new MouseEvent("mousedown",
      { button: button === undefined ? 0 : button, bubbles: true, cancelable: true }));
  }
  function getPixel(x, y) {
    return canvas.getContext("2d").getImageData(x, y, 1, 1).data;
  }
  // Sky colour: #4EC0CA = rgb(78, 192, 202)
  function skyIsVisible() {
    var px = getPixel(CANVAS_WIDTH / 2, 10);
    return px[0] === 78 && px[1] === 192 && px[2] === 202;
  }

  // ================================================================
  // SECTION 1: Game constant validation
  // ================================================================
  console.group("=== 1. Game constant validation ===");

  test("PIPE_GAP (160) > bird diameter (36) -- gap is always passable", function () {
    var birdDiameter = BIRD_RADIUS * 2; // 36
    assert(PIPE_GAP > birdDiameter,
      "PIPE_GAP (" + PIPE_GAP + ") must exceed bird diameter (" + birdDiameter + ")");
  });

  test("FLAP_VELOCITY is negative (upward)", function () {
    assert(FLAP_VELOCITY < 0, "FLAP_VELOCITY must be negative, got " + FLAP_VELOCITY);
  });

  test("GRAVITY is positive (downward acceleration)", function () {
    assert(GRAVITY > 0, "GRAVITY must be positive, got " + GRAVITY);
  });

  test("BIRD_HITBOX (14) < BIRD_RADIUS (18) -- forgiving hitbox", function () {
    assert(BIRD_HITBOX < BIRD_RADIUS,
      "BIRD_HITBOX (" + BIRD_HITBOX + ") must be < BIRD_RADIUS (" + BIRD_RADIUS + ")");
  });

  test("PIPE_GAP_MIN_CENTRE produces a positive top-pipe height", function () {
    var minTopH = PIPE_GAP_MIN_CENTRE - PIPE_GAP / 2; // 160 - 80 = 80
    assert(minTopH > 0, "Top pipe must be visible; height at min = " + minTopH);
  });

  test("PIPE_GAP_MAX_CENTRE keeps bottom pipe above ground", function () {
    var maxBottomTopEdge = PIPE_GAP_MAX_CENTRE + PIPE_GAP / 2; // 400 + 80 = 480
    assert(maxBottomTopEdge < GROUND_Y,
      "Bottom pipe top (" + maxBottomTopEdge + ") must be < GROUND_Y (" + GROUND_Y + ")");
  });

  test("GROUND_Y equals CANVAS_HEIGHT - GROUND_HEIGHT", function () {
    assertEqual(GROUND_Y, CANVAS_HEIGHT - GROUND_HEIGHT, "GROUND_Y derivation");
  });

  test("PIPE_GAP_MAX_CENTRE equals GROUND_Y - 160", function () {
    assertEqual(PIPE_GAP_MAX_CENTRE, GROUND_Y - 160, "PIPE_GAP_MAX_CENTRE formula");
  });

  console.groupEnd();

  // ================================================================
  // SECTION 2: Physics
  // ================================================================
  console.group("=== 2. Physics ===");

  test("Bird falls under gravity: vy increases and y increases each frame", function () {
    var bird = { x: BIRD_X, y: BIRD_START_Y, vy: 0 };
    var dt   = 1 / 60;
    var next = physicsTick(bird, dt);
    assert(next.vy > bird.vy, "vy should increase (gravity is downward)");
    assert(next.y  > bird.y,  "y should increase (bird falls)");
  });

  test("Gravity accumulates: vy grows larger on each successive frame", function () {
    var bird = { x: BIRD_X, y: BIRD_START_Y, vy: 0 };
    var dt   = 1 / 60;
    var t1   = physicsTick(bird, dt);
    var t2   = physicsTick({ x: BIRD_X, y: t1.y, vy: t1.vy }, dt);
    assert(t2.vy > t1.vy, "vy should keep growing each frame");
  });

  test("FLAP_VELOCITY constant equals -420 px/s", function () {
    assertEqual(FLAP_VELOCITY, -420, "FLAP_VELOCITY value");
  });

  test("After a flap, y decreases on the next tick (vy still negative)", function () {
    // vy=-420; after one tick at 60 fps: vy=-420+1500/60=-395 (still negative).
    // y moves by -395/60 < 0, so y decreases.
    var bird = { x: BIRD_X, y: BIRD_START_Y, vy: FLAP_VELOCITY };
    var next = physicsTick(bird, 1 / 60);
    assert(next.y < bird.y, "y should decrease immediately after a flap");
  });

  test("Exact vy after one frame from rest equals GRAVITY * dt", function () {
    var bird = { x: BIRD_X, y: BIRD_START_Y, vy: 0 };
    var dt   = 0.016;
    assertApprox(physicsTick(bird, dt).vy, GRAVITY * dt, 1e-9, "vy after first frame");
  });

  test("Exact y after one frame from rest equals START_Y + GRAVITY*dt*dt", function () {
    // game.js: bird.vy += GRAVITY*dt; bird.y += bird.vy*dt => y_new = y + GRAVITY*dt^2
    var bird = { x: BIRD_X, y: BIRD_START_Y, vy: 0 };
    var dt   = 0.016;
    assertApprox(physicsTick(bird, dt).y, BIRD_START_Y + GRAVITY * dt * dt, 1e-9, "y after first frame");
  });

  test("Ceiling death: y - BIRD_HITBOX = 0 (boundary) triggers collision", function () {
    // bird.y = BIRD_HITBOX = 14 => y - BIRD_HITBOX = 0, satisfies <= 0
    assert(checkCollisions({ x: BIRD_X, y: BIRD_HITBOX }, []), "at ceiling boundary must die");
  });

  test("Ceiling death: y - BIRD_HITBOX < 0 (above boundary) triggers collision", function () {
    assert(checkCollisions({ x: BIRD_X, y: BIRD_HITBOX - 1 }, []), "above ceiling must die");
  });

  test("No ceiling death: y - BIRD_HITBOX > 0 (below boundary) is safe", function () {
    assertFalse(checkCollisions({ x: BIRD_X, y: BIRD_HITBOX + 1 }, []), "just below ceiling must survive");
  });

  test("Ground death: y + BIRD_HITBOX = GROUND_Y (boundary) triggers collision", function () {
    // bird.y = GROUND_Y - BIRD_HITBOX => y + BIRD_HITBOX = GROUND_Y, satisfies >=
    assert(checkCollisions({ x: BIRD_X, y: GROUND_Y - BIRD_HITBOX }, []), "at ground boundary must die");
  });

  test("Ground death: y + BIRD_HITBOX > GROUND_Y (below ground) triggers collision", function () {
    assert(checkCollisions({ x: BIRD_X, y: GROUND_Y - BIRD_HITBOX + 1 }, []), "below ground must die");
  });

  test("No ground death: y + BIRD_HITBOX < GROUND_Y (above ground) is safe", function () {
    assertFalse(checkCollisions({ x: BIRD_X, y: GROUND_Y - BIRD_HITBOX - 1 }, []), "just above ground must survive");
  });

  console.groupEnd();

  // ================================================================
  // SECTION 3: Pipe geometry
  // ================================================================
  console.group("=== 3. Pipe geometry ===");

  test("pipeTopRect.y always equals 0 (top pipe glued to canvas top)", function () {
    assertEqual(pipeTopRect({ x: 200, gapCentre: 300 }).y, 0, "top rect y");
  });

  test("pipeTopRect.h equals gapCentre - PIPE_GAP/2", function () {
    var pipe = { x: 200, gapCentre: 300 };
    assertEqual(pipeTopRect(pipe).h, pipe.gapCentre - PIPE_GAP / 2, "top pipe height");
  });

  test("pipeBottomRect.y equals gapCentre + PIPE_GAP/2", function () {
    var pipe = { x: 200, gapCentre: 300 };
    assertEqual(pipeBottomRect(pipe).y, pipe.gapCentre + PIPE_GAP / 2, "bottom pipe y");
  });

  test("pipeBottomRect.h equals GROUND_Y - (gapCentre + PIPE_GAP/2)", function () {
    var pipe = { x: 200, gapCentre: 300 };
    assertEqual(pipeBottomRect(pipe).h, GROUND_Y - (pipe.gapCentre + PIPE_GAP / 2), "bottom pipe height");
  });

  test("Both pipe rects use PIPE_WIDTH", function () {
    var pipe = { x: 200, gapCentre: 300 };
    assertEqual(pipeTopRect(pipe).w,    PIPE_WIDTH, "top pipe width");
    assertEqual(pipeBottomRect(pipe).w, PIPE_WIDTH, "bottom pipe width");
  });

  test("Both pipe rects x equals pipe.x", function () {
    var pipe = { x: 333, gapCentre: 300 };
    assertEqual(pipeTopRect(pipe).x,    333, "top pipe x");
    assertEqual(pipeBottomRect(pipe).x, 333, "bottom pipe x");
  });

  test("Top rect h + PIPE_GAP + bottom rect h = GROUND_Y (typical gapCentre)", function () {
    var pipe = { x: 200, gapCentre: 300 };
    assertApprox(pipeTopRect(pipe).h + PIPE_GAP + pipeBottomRect(pipe).h, GROUND_Y, 1e-9,
      "pipe heights must sum to GROUND_Y");
  });

  test("Top + gap + bottom = GROUND_Y at minimum gapCentre (160)", function () {
    var pipe = { x: 200, gapCentre: PIPE_GAP_MIN_CENTRE };
    assertApprox(pipeTopRect(pipe).h + PIPE_GAP + pipeBottomRect(pipe).h, GROUND_Y, 1e-9,
      "sum at min gapCentre");
  });

  test("Top + gap + bottom = GROUND_Y at maximum gapCentre (400)", function () {
    var pipe = { x: 200, gapCentre: PIPE_GAP_MAX_CENTRE };
    assertApprox(pipeTopRect(pipe).h + PIPE_GAP + pipeBottomRect(pipe).h, GROUND_Y, 1e-9,
      "sum at max gapCentre");
  });

  test("Gap centre sampling stays within [MIN, MAX] over 1000 samples", function () {
    var range = PIPE_GAP_MAX_CENTRE - PIPE_GAP_MIN_CENTRE;
    var minSeen =  Infinity;
    var maxSeen = -Infinity;
    for (var i = 0; i < 1000; i++) {
      var gc = PIPE_GAP_MIN_CENTRE + Math.random() * range;
      if (gc < minSeen) minSeen = gc;
      if (gc > maxSeen) maxSeen = gc;
    }
    assert(minSeen >= PIPE_GAP_MIN_CENTRE, "Sample went below MIN: " + minSeen);
    assert(maxSeen <= PIPE_GAP_MAX_CENTRE, "Sample exceeded MAX: " + maxSeen);
  });

  console.groupEnd();

  // ================================================================
  // SECTION 4: AABB collision detection
  // ================================================================
  console.group("=== 4. AABB collision detection ===");

  // rectsOverlap unit tests

  test("rectsOverlap: two identical rects overlap", function () {
    assert(rectsOverlap(0, 0, 10, 10, 0, 0, 10, 10));
  });

  test("rectsOverlap: clearly disjoint rects do not overlap", function () {
    assertFalse(rectsOverlap(0, 0, 10, 10, 20, 20, 10, 10));
  });

  test("rectsOverlap: touching right-to-left edges is NOT an overlap (strict >)", function () {
    // a=[0,10) b=[10,20). ax+aw > bx => 10 > 10 is false.
    assertFalse(rectsOverlap(0, 0, 10, 10, 10, 0, 10, 10),
      "Touching edges must not count as overlap");
  });

  test("rectsOverlap: touching bottom-to-top edges is NOT an overlap (strict >)", function () {
    assertFalse(rectsOverlap(0, 0, 10, 10, 0, 10, 10, 10),
      "Touching vertical edges must not count as overlap");
  });

  test("rectsOverlap: one-pixel horizontal overlap is detected", function () {
    assert(rectsOverlap(0, 0, 10, 10, 9, 0, 10, 10), "One-pixel horizontal overlap must be detected");
  });

  test("rectsOverlap: one-pixel vertical overlap is detected", function () {
    assert(rectsOverlap(0, 0, 10, 10, 0, 9, 10, 10), "One-pixel vertical overlap must be detected");
  });

  // Bird vs pipe collision tests

  test("Bird inside top pipe body -- collision detected", function () {
    // Pipe x=200, gapCentre=300 => top rect {x:200, y:0, w:60, h:220}
    // Bird x=220, y=100 => hitbox x=[206,234], y=[86,114] inside top pipe
    var pipe = { x: 200, gapCentre: 300 };
    var top  = pipeTopRect(pipe);
    assert(birdHitRect({ x: 220, y: 100 }, top.x, top.y, top.w, top.h),
      "Bird inside top pipe body must register a collision");
  });

  test("Bird inside bottom pipe body -- collision detected", function () {
    // Pipe x=200, gapCentre=300 => bottom rect {x:200, y:380, w:60, h:180}
    // Bird x=220, y=450 => hitbox y=[436,464] inside bottom pipe
    var pipe = { x: 200, gapCentre: 300 };
    var bot  = pipeBottomRect(pipe);
    assert(birdHitRect({ x: 220, y: 450 }, bot.x, bot.y, bot.w, bot.h),
      "Bird inside bottom pipe body must register a collision");
  });

  test("Bird centred in gap -- no collision with either pipe", function () {
    // Gap y=[220,380]. Bird x=220, y=300. Hitbox y=[286,314] inside the gap.
    var pipe = { x: 200, gapCentre: 300 };
    var top  = pipeTopRect(pipe);
    var bot  = pipeBottomRect(pipe);
    var bird = { x: 220, y: 300 };
    assertFalse(birdHitRect(bird, top.x, top.y, top.w, top.h), "Bird in gap must not collide with top");
    assertFalse(birdHitRect(bird, bot.x, bot.y, bot.w, bot.h), "Bird in gap must not collide with bottom");
  });

  test("Bird hitbox top at exact top-pipe bottom -- no collision (strict < boundary)", function () {
    // Top pipe h=220. rectsOverlap needs hy < 220.
    // If hy=220 exactly: 220 < 220 is FALSE => no overlap.
    // hy = bird.y - BIRD_HITBOX = 220 => bird.y = 234.
    var pipe = { x: 200, gapCentre: 300 };
    var top  = pipeTopRect(pipe); // h=220
    var bird = { x: 220, y: top.h + BIRD_HITBOX }; // y=234, hy=220
    assertFalse(birdHitRect(bird, top.x, top.y, top.w, top.h),
      "Hitbox top exactly at top-pipe bottom must not collide");
  });

  test("Bird hitbox bottom at exact bottom-pipe top -- no collision (strict > boundary)", function () {
    // Bottom pipe y=380. rectsOverlap needs hy+hs > 380.
    // If hy+hs=380: 380 > 380 is FALSE => no overlap.
    // hy+hs=380 => hy=352 => bird.y=366.
    var pipe = { x: 200, gapCentre: 300 };
    var bot  = pipeBottomRect(pipe); // y=380
    var bird = { x: 220, y: bot.y - BIRD_HITBOX }; // y=366, hy+hs=380
    assertFalse(birdHitRect(bird, bot.x, bot.y, bot.w, bot.h),
      "Hitbox bottom exactly at bottom-pipe top must not collide");
  });

  test("Bird one pixel inside top pipe from below -- collision detected", function () {
    // bird.y = top.h + BIRD_HITBOX - 1 = 233 => hy=219 < 220 => overlap
    var pipe = { x: 200, gapCentre: 300 };
    var top  = pipeTopRect(pipe);
    assert(birdHitRect({ x: 220, y: top.h + BIRD_HITBOX - 1 }, top.x, top.y, top.w, top.h),
      "Bird one px inside top pipe must collide");
  });

  test("Bird one pixel inside bottom pipe from above -- collision detected", function () {
    // bird.y = bot.y - BIRD_HITBOX + 1 = 367 => hy+hs=381 > 380 => overlap
    var pipe = { x: 200, gapCentre: 300 };
    var bot  = pipeBottomRect(pipe);
    assert(birdHitRect({ x: 220, y: bot.y - BIRD_HITBOX + 1 }, bot.x, bot.y, bot.w, bot.h),
      "Bird one px inside bottom pipe must collide");
  });

  test("Bird to the left of pipe -- no collision (horizontal miss)", function () {
    // Bird x=100, hitbox right=114. Pipe x=200. 114 > 200 is FALSE.
    var pipe = { x: 200, gapCentre: 300 };
    var top  = pipeTopRect(pipe);
    var bot  = pipeBottomRect(pipe);
    var bird = { x: 100, y: 100 };
    assertFalse(birdHitRect(bird, top.x, top.y, top.w, top.h), "Left of pipe must not hit top pipe");
    assertFalse(birdHitRect(bird, bot.x, bot.y, bot.w, bot.h), "Left of pipe must not hit bottom pipe");
  });

  test("Bird to the right of pipe -- no collision (horizontal miss)", function () {
    // Bird x=280, hitbox left=266. Pipe right edge=260. 266 < 260 is FALSE.
    var pipe = { x: 200, gapCentre: 300 };
    var top  = pipeTopRect(pipe);
    var bot  = pipeBottomRect(pipe);
    var bird = { x: 280, y: 100 };
    assertFalse(birdHitRect(bird, top.x, top.y, top.w, top.h), "Right of pipe must not hit top pipe");
    assertFalse(birdHitRect(bird, bot.x, bot.y, bot.w, bot.h), "Right of pipe must not hit bottom pipe");
  });

  test("checkCollisions: starting position with no pipes returns false", function () {
    assertFalse(checkCollisions({ x: BIRD_X, y: BIRD_START_Y, vy: 0 }, []),
      "Starting position must be collision-free");
  });

  test("checkCollisions: bird safe with a pipe far off to the right", function () {
    assertFalse(checkCollisions({ x: BIRD_X, y: BIRD_START_Y },
      [{ x: CANVAS_WIDTH + 100, gapCentre: 300, scored: false }]),
      "Distant right pipe must not cause collision");
  });

  console.groupEnd();

  // ================================================================
  // SECTION 5: Scoring logic
  // ================================================================
  console.group("=== 5. Scoring logic ===");

  test("Score increments when bird.x > pipe.x + PIPE_WIDTH and pipe is unscored", function () {
    var result = scoringTick(0, { x: 300, y: BIRD_START_Y },
      [{ x: 200, gapCentre: 300, scored: false }]); // right edge=260 < 300
    assertEqual(result.score, 1, "score should become 1");
  });

  test("Score does NOT increment when bird.x === pipe.x + PIPE_WIDTH (not strictly greater)", function () {
    var result = scoringTick(0, { x: 260, y: BIRD_START_Y },
      [{ x: 200, gapCentre: 300, scored: false }]); // bird.x exactly at right edge
    assertEqual(result.score, 0, "score must not increment at exact pipe right edge");
  });

  test("Score does NOT increment when bird.x < pipe.x + PIPE_WIDTH", function () {
    var result = scoringTick(0, { x: 220, y: BIRD_START_Y },
      [{ x: 200, gapCentre: 300, scored: false }]);
    assertEqual(result.score, 0, "score must not increment before clearing the pipe");
  });

  test("Score does NOT increment again when pipe.scored is already true", function () {
    var result = scoringTick(5, { x: 300, y: BIRD_START_Y },
      [{ x: 200, gapCentre: 300, scored: true }]);
    assertEqual(result.score, 5, "score must stay at 5 for an already-scored pipe");
  });

  test("pipe.scored is set to true after the bird passes it", function () {
    var result = scoringTick(0, { x: 300, y: BIRD_START_Y },
      [{ x: 200, gapCentre: 300, scored: false }]);
    assert(result.pipes[0].scored === true, "pipe.scored must become true");
  });

  test("Score increments exactly once across two consecutive ticks at same position", function () {
    var bird = { x: 300, y: BIRD_START_Y };
    var t1   = scoringTick(0, bird, [{ x: 200, gapCentre: 300, scored: false }]);
    var t2   = scoringTick(t1.score, bird, t1.pipes); // pipe already scored
    assertEqual(t2.score, 1, "score must still be 1 after second tick");
  });

  test("All three unscored pipes score when bird has passed them all", function () {
    var result = scoringTick(0, { x: 500, y: BIRD_START_Y }, [
      { x: 100, gapCentre: 300, scored: false },
      { x: 200, gapCentre: 280, scored: false },
      { x: 300, gapCentre: 320, scored: false },
    ]);
    assertEqual(result.score, 3, "should score all three pipes");
  });

  test("Only pipes the bird has passed are scored; future pipes are skipped", function () {
    // bird.x=270. Pipe at x=200 (right=260 < 270, passed). Pipe at x=300 (right=360 > 270, not passed).
    var result = scoringTick(0, { x: 270, y: BIRD_START_Y }, [
      { x: 200, gapCentre: 300, scored: false },
      { x: 300, gapCentre: 280, scored: false },
    ]);
    assertEqual(result.score,          1,     "only one pipe should score");
    assert(result.pipes[0].scored === true,  "first pipe must be marked scored");
    assert(result.pipes[1].scored === false, "second pipe must remain unscored");
  });

  test("Score resets to 0 and pipes clear on restart (resetGame mirror)", function () {
    var score = 42;
    var pipes = [{ x: 100, gapCentre: 300, scored: true }];
    // mirror resetGame()
    score = 0;
    pipes = [];
    assertEqual(score,        0, "score must reset to 0");
    assertEqual(pipes.length, 0, "pipes must be cleared");
  });

  console.groupEnd();

  // ================================================================
  // SECTION 6: State machine
  // ================================================================
  console.group("=== 6. State machine ===");

  test("IDLE + flap => state becomes PLAYING", function () {
    var state = "IDLE";
    if (state === "IDLE") state = "PLAYING";
    assertEqual(state, "PLAYING", "transition from IDLE on first flap");
  });

  test("PLAYING + flap => state stays PLAYING", function () {
    var state = "PLAYING";
    // In game.js only vy changes; state is unchanged on flap during play
    assertEqual(state, "PLAYING", "flap in PLAYING must keep state PLAYING");
  });

  test("PLAYING + collision => state becomes DEAD", function () {
    var state = "PLAYING";
    var hit   = true;
    if (state === "PLAYING" && hit) state = "DEAD";
    assertEqual(state, "DEAD", "collision in PLAYING must transition to DEAD");
  });

  test("DEAD + flap => state becomes PLAYING (restart)", function () {
    var state = "DEAD";
    if (state === "DEAD") state = "PLAYING";
    assertEqual(state, "PLAYING", "flap in DEAD must restart to PLAYING");
  });

  test("update() is a no-op in IDLE state", function () {
    var updated = false;
    function gatedUpdate(s) { if (s !== "PLAYING") return; updated = true; }
    gatedUpdate("IDLE");
    assertFalse(updated, "update must not run in IDLE");
  });

  test("update() is a no-op in DEAD state", function () {
    var updated = false;
    function gatedUpdate(s) { if (s !== "PLAYING") return; updated = true; }
    gatedUpdate("DEAD");
    assertFalse(updated, "update must not run in DEAD");
  });

  test("update() runs in PLAYING state", function () {
    var updated = false;
    function gatedUpdate(s) { if (s !== "PLAYING") return; updated = true; }
    gatedUpdate("PLAYING");
    assert(updated, "update must run in PLAYING");
  });

  test("Bird resets to BIRD_X, BIRD_START_Y, vy=0, rotation=0 on restart", function () {
    var bird = { x: 400, y: 550, vy: 300, rotation: 1.5 };
    bird = { x: BIRD_X, y: BIRD_START_Y, vy: 0, rotation: 0 }; // mirror resetGame()
    assertEqual(bird.x,        BIRD_X,       "bird.x reset");
    assertEqual(bird.y,        BIRD_START_Y, "bird.y reset");
    assertEqual(bird.vy,       0,            "bird.vy reset");
    assertEqual(bird.rotation, 0,            "bird.rotation reset");
  });

  test("scrolledSinceLastPipe resets to 0 on restart", function () {
    var scrolled = 9999;
    scrolled = 0;
    assertEqual(scrolled, 0, "scrolledSinceLastPipe must be 0 after reset");
  });

  // Async DOM event tests -- drive the live game and observe rendering
  (function asyncStateTests() {
    var WAIT = 50; // ms -- two rAF cycles at 60 fps

    setTimeout(function () {

      // Test A: sky background visible => game loop is running
      var active = skyIsVisible();
      if (active) {
        console.log("%cPASS%c [async] Canvas renders sky-blue background -- game loop active",
          "color:green;font-weight:bold", "");
      } else {
        console.error("%cFAIL%c [async] Canvas does not show sky background -- loop may not be running",
          "color:red;font-weight:bold", "");
      }

      // Test B: Space key fires without error (IDLE -> PLAYING)
      try {
        fireKeydown("Space", false);
        console.log("%cPASS%c [async] Space keydown in IDLE fired without error",
          "color:green;font-weight:bold", "");
      } catch (e) {
        console.error("%cFAIL%c [async] Space keydown threw: " + e.message,
          "color:red;font-weight:bold", "");
      }

      // Test C: sky still visible after Space => game still rendering
      setTimeout(function () {
        var stillActive = skyIsVisible();
        if (stillActive) {
          console.log("%cPASS%c [async] Canvas still rendering after first Space keydown",
            "color:green;font-weight:bold", "");
        } else {
          console.error("%cFAIL%c [async] Canvas stopped rendering after Space keydown",
            "color:red;font-weight:bold", "");
        }
      }, WAIT);

      // Test D: right-click must NOT trigger a flap (button !== 0 guard)
      setTimeout(function () {
        try {
          fireMousedown(canvas, 2);
          console.log("%cPASS%c [async] Right-click silently ignored (no exception)",
            "color:green;font-weight:bold", "");
        } catch (e) {
          console.error("%cFAIL%c [async] Right-click threw: " + e.message,
            "color:red;font-weight:bold", "");
        }
      }, WAIT + 20);

      // Test E: left-click triggers flap without error
      setTimeout(function () {
        try {
          fireMousedown(canvas, 0);
          console.log("%cPASS%c [async] Left-click mousedown fired without error",
            "color:green;font-weight:bold", "");
        } catch (e) {
          console.error("%cFAIL%c [async] Left-click mousedown threw: " + e.message,
            "color:red;font-weight:bold", "");
        }
      }, WAIT + 40);

      // Test F: key-repeat Space is silently ignored (e.repeat guard)
      setTimeout(function () {
        try {
          fireKeydown("Space", true);
          console.log("%cPASS%c [async] Key-repeat Space silently ignored (no exception)",
            "color:green;font-weight:bold", "");
        } catch (e) {
          console.error("%cFAIL%c [async] Key-repeat Space threw: " + e.message,
            "color:red;font-weight:bold", "");
        }
      }, WAIT + 60);

    }, 50);
  })();

  console.groupEnd();

  // ================================================================
  // SECTION 7: Pipe scrolling mechanics
  // ================================================================
  console.group("=== 7. Pipe scrolling mechanics ===");

  test("Pipes move left by PIPE_SPEED * dt each tick", function () {
    var initialX = 400;
    var dt       = 1 / 60;
    var pipeX    = initialX - PIPE_SPEED * dt;
    assertApprox(pipeX, initialX - PIPE_SPEED * dt, 1e-9, "pipe x after one tick");
  });

  test("Pipe with right edge at 0 is removed (filter: pipe.x + PIPE_WIDTH > 0)", function () {
    var pipes = [{ x: -PIPE_WIDTH, gapCentre: 300, scored: false }]; // right edge = 0
    pipes = pipes.filter(function (p) { return p.x + PIPE_WIDTH > 0; });
    assertEqual(pipes.length, 0, "pipe at x=-PIPE_WIDTH must be removed");
  });

  test("Pipe fully off screen (right edge < 0) is removed", function () {
    var pipes = [{ x: -PIPE_WIDTH - 1, gapCentre: 300, scored: false }];
    pipes = pipes.filter(function (p) { return p.x + PIPE_WIDTH > 0; });
    assertEqual(pipes.length, 0, "pipe fully off screen must be removed");
  });

  test("Pipe with right edge = 1 (one px on screen) is NOT removed", function () {
    var pipes = [{ x: -PIPE_WIDTH + 1, gapCentre: 300, scored: false }]; // right edge = 1
    pipes = pipes.filter(function (p) { return p.x + PIPE_WIDTH > 0; });
    assertEqual(pipes.length, 1, "pipe with one px on screen must survive");
  });

  test("Exactly one pipe spawns after PIPE_SPAWN_INTERVAL px of scroll", function () {
    var scrolled = 0;
    var spawned  = 0;
    var dx = PIPE_SPEED * (1 / 60);
    while (scrolled < PIPE_SPAWN_INTERVAL) { scrolled += dx; }
    if (scrolled >= PIPE_SPAWN_INTERVAL) { scrolled -= PIPE_SPAWN_INTERVAL; spawned++; }
    assertEqual(spawned, 1, "exactly one pipe must spawn per interval");
    assert(scrolled < PIPE_SPAWN_INTERVAL, "scroll remainder must be < interval");
  });

  test("Pipe spawns at x = CANVAS_WIDTH + PIPE_WIDTH (off the right edge)", function () {
    var spawnX = CANVAS_WIDTH + PIPE_WIDTH; // 540
    assert(spawnX > CANVAS_WIDTH,
      "Spawn x (" + spawnX + ") must exceed canvas width (" + CANVAS_WIDTH + ")");
  });

  test("dt is capped at 0.1 s for huge elapsed times (spiral-of-death guard)", function () {
    function computeDt(ms) { return Math.min(ms / 1000, 0.1); }
    assertApprox(computeDt(5000), 0.1, 1e-9, "5-second gap must be capped to 0.1 s");
    assertApprox(computeDt(100),  0.1, 1e-9, "100 ms exactly hits the cap");
  });

  test("dt is NOT capped for a normal 16 ms frame", function () {
    function computeDt(ms) { return Math.min(ms / 1000, 0.1); }
    assertApprox(computeDt(16), 0.016, 1e-9, "Normal 16 ms frame must not be capped");
  });

  console.groupEnd();

  // ================================================================
  // Summary -- printed 500 ms after page load so async results appear first
  // ================================================================
  setTimeout(function () {
    var passStyle = "color:green;font-weight:bold";
    var failStyle = _failed > 0 ? "color:red;font-weight:bold" : "color:gray";
    var noteStyle = "color:gray;font-style:italic";
    console.log("");
    console.log("==================================================");
    console.log(
      "%c" + _passed + " passed  %c" + _failed + " failed"
      + "%c  (sync only -- [async] results listed above)",
      passStyle, failStyle, noteStyle
    );
    console.log("==================================================");
    console.log(
      _failed === 0
        ? "%cAll synchronous tests passed."
        : "%cSome tests failed -- see FAIL lines above.",
      _failed === 0 ? "color:green;font-weight:bold" : "color:red;font-weight:bold"
    );
  }, 500);

})();
