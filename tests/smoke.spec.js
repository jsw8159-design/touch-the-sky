// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Persisted regression suite for 하늘에 닿고 싶어 (Touch the Sky).
 *
 * These use the game's real UI (taps/keys) wherever practical, and fall back to the
 * window.__ttsTest bridge (see index.html) only for states that depend on randomness
 * (obstacle spawns/types) or long play sessions (30-combo escalation) that would make
 * the suite slow or flaky if reached through pure input simulation.
 *
 * Every test asserts page.on('pageerror') stayed empty - that's what would have caught
 * the t/tr variable-shadowing crash before it ever reached production.
 */

function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

async function waitForCanvasPainted(page) {
  await page.waitForFunction(() => {
    const c = document.getElementById('gameCanvas');
    if (!c) return false;
    const ctx = c.getContext('2d');
    try { return ctx.getImageData(0, 0, 1, 1).data[3] > 0; } catch (e) { return false; }
  }, { timeout: 10000 });
}

test.describe('boot', () => {
  test('loads and paints the start screen with no errors', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/index.html');
    await waitForCanvasPainted(page);
    const state = await page.evaluate(() => window.__ttsTest.getState());
    expect(state.state).toBe('start');
    expect(errors).toEqual([]);
  });

  test('required assets resolve (no 404s for audio/icons/manifest)', async ({ page }) => {
    const failed = [];
    page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
    await page.goto('/index.html');
    await waitForCanvasPainted(page);
    await page.evaluate(() => window.__ttsTest.ensureAudio());
    await page.waitForTimeout(1200);
    expect(failed).toEqual([]);
  });
});

test.describe('core gameplay loop', () => {
  test('tap to start, jump twice, land successfully and gain height', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/index.html');
    await waitForCanvasPainted(page);

    await page.keyboard.press('Space'); // start
    await page.waitForTimeout(250);
    await page.keyboard.press('Space'); // jump1
    await page.waitForTimeout(300);
    await page.keyboard.press('Space'); // jump2
    await page.waitForTimeout(700);

    const st = await page.evaluate(() => window.__ttsTest.getState());
    expect(st.state).toBe('playing');
    expect(st.height).toBeGreaterThan(0);
    expect(st.landings).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test('hitting an obstacle resets combo without crashing', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/index.html');
    await waitForCanvasPainted(page);
    await page.keyboard.press('Space');
    await page.waitForTimeout(250);

    await page.evaluate(() => window.__ttsTest.setCombo(6));
    await page.keyboard.press('Space'); // jump1 -> airborne
    await page.waitForTimeout(80);
    await page.evaluate(() => window.__ttsTest.forceObstacle('drop'));
    await page.waitForTimeout(200);

    const st = await page.evaluate(() => window.__ttsTest.getState());
    expect(st.combo).toBe(0);
    expect(errors).toEqual([]);
  });

  test('friend encounter completes high-five -> ascend -> resting (regression: t/tr shadowing crash)', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/index.html');
    await waitForCanvasPainted(page);
    await page.keyboard.press('Space');
    await page.waitForTimeout(250);
    await page.keyboard.press('Space'); // airborne
    await page.waitForTimeout(80);

    await page.evaluate(() => window.__ttsTest.forceObstacle('friend'));
    await page.waitForTimeout(60);
    let st = await page.evaluate(() => window.__ttsTest.getState());
    expect(st.charState).toBe('friend_highfive');

    await page.waitForTimeout(2500);
    st = await page.evaluate(() => window.__ttsTest.getState());
    expect(st.charState).toBe('resting');
    expect(st.height).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test('30-combo escalation (sfx/shout/afterimage trail) fires without crashing', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/index.html');
    await waitForCanvasPainted(page);
    await page.evaluate(() => window.__ttsTest.ensureAudio());
    await page.keyboard.press('Space');
    await page.waitForTimeout(250);

    await page.evaluate(() => window.__ttsTest.setCombo(29));
    await page.keyboard.press('Space'); // jump1
    await page.waitForTimeout(300);
    await page.keyboard.press('Space'); // jump2 -> lands, combo becomes 30
    await page.waitForTimeout(600);

    const st = await page.evaluate(() => window.__ttsTest.getState());
    expect(st.combo).toBe(30);
    expect(errors).toEqual([]);
  });

  test('star invincibility protects the helmet and lasts exactly 3 landings, not a timer', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/index.html');
    await waitForCanvasPainted(page);
    await page.keyboard.press('Space');
    await page.waitForTimeout(250);

    await page.evaluate(() => window.__ttsTest.setHelmetLevel(2));
    await page.evaluate(() => window.__ttsTest.grantStarInvincibility());
    await page.evaluate(() => window.__ttsTest.setCombo(7));

    await page.keyboard.press('Space'); // airborne
    await page.waitForTimeout(80);
    await page.evaluate(() => window.__ttsTest.forceObstacle('drop'));
    await page.waitForTimeout(150);

    // while invincible, a damaging obstacle must be fully harmless: helmet kept, no hp
    // loss, no combo reset (regression: helmet used to be consumed even while invincible)
    let st = await page.evaluate(() => window.__ttsTest.getState());
    expect(st.helmetLevel).toBe(2);
    expect(st.hp).toBe(3);
    expect(st.combo).toBe(7);
    expect(st.starInvincibleWallsLeft).toBe(3);

    // land 3 times (3 "wall touches") - invincibility should end exactly then, not on a timer
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Space'); // jump1
      await page.waitForTimeout(300);
      await page.keyboard.press('Space'); // jump2 -> lands
      await page.waitForTimeout(700);
    }
    st = await page.evaluate(() => window.__ttsTest.getState());
    expect(st.starInvincibleWallsLeft).toBe(0);
    expect(errors).toEqual([]);
  });

  test('game over then restart works, and the run resets cleanly', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/index.html');
    await waitForCanvasPainted(page);
    await page.keyboard.press('Space'); // start
    await page.waitForTimeout(200);
    // let the idle rest-timer expire (~3.4-4.4s) then the fall/death animation (~0.5-1s)
    // play out so the run ends deterministically - poll instead of a fixed sleep since
    // the exact timing depends on difficulty scaling constants that may shift later
    await page.waitForFunction(() => window.__ttsTest.getState().state === 'gameover', { timeout: 10000 });
    let st = await page.evaluate(() => window.__ttsTest.getState());
    expect(st.state).toBe('gameover');

    await page.keyboard.press('Space'); // restart
    await page.waitForTimeout(200);
    st = await page.evaluate(() => window.__ttsTest.getState());
    expect(st.state).toBe('playing');
    expect(st.height).toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe('overlays', () => {
  for (const lang of ['ko', 'en']) {
    test(`leaderboard / missions / achievements / costume / settings open+close cleanly [${lang}]`, async ({ page }) => {
      const errors = trackErrors(page);
      await page.goto('/index.html');
      await waitForCanvasPainted(page);
      if (lang === 'en') {
        await page.click('#btnLang');
        await page.waitForTimeout(100);
      }

      await page.click('#btnLeaderboard');
      await page.click('#btnLbGlobal');
      await page.waitForTimeout(200);
      await page.click('#btnLbStats');
      await page.waitForTimeout(100);
      await page.click('#btnLbClose');

      await page.click('#btnMissions');
      await page.click('#btnAchTab');
      await page.waitForTimeout(100);
      await page.mouse.click(50, 250); // tap empty space to close

      await page.click('#btnCostume');
      await page.waitForTimeout(100);
      await page.click('#btnCostumeNext');
      await page.mouse.click(50, 250);

      await page.click('#btnSettings');
      await page.click('#btnVibCycle');
      await page.click('#btnColorblind');
      await page.mouse.click(50, 250);

      const st = await page.evaluate(() => window.__ttsTest.getState());
      expect(st.showLeaderboard).toBe(false);
      expect(st.showMissions).toBe(false);
      expect(st.showCostume).toBe(false);
      expect(st.showSettings).toBe(false);
      expect(errors).toEqual([]);
    });
  }

  test('language toggle actually changes rendered UI text', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/index.html');
    await waitForCanvasPainted(page);
    let st = await page.evaluate(() => window.__ttsTest.getState());
    expect(st.lang).toBe('ko');

    await page.click('#btnLang');
    await page.waitForTimeout(150);
    st = await page.evaluate(() => window.__ttsTest.getState());
    expect(st.lang).toBe('en');
    await expect(page.locator('#btnLang')).toContainText('한글');
    expect(errors).toEqual([]);
  });
});
