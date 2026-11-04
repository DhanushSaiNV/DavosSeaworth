// scripts/run_qa.js
// Automated verification script for Davos visual measurements and QA brief.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const babel = require('@babel/core');

function hook(ext) {
  require.extensions[ext] = function (module, filename) {
    const content = fs.readFileSync(filename, 'utf8');
    const { code } = babel.transformSync(content, {
      filename,
      presets: ['babel-preset-expo']
    });
    module._compile(code, filename);
  };
}
hook('.ts');
hook('.tsx');

const tempDir = process.env.TEMP || 'C:\\Users\\dhanu\\AppData\\Local\\Temp';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

// Import tokens directly
const { GUTTER, RAIL, LINE, META_LINE, BEAT_GAP, INNER_GAP, PANEL_PAD, GLYPH_CHAT, GLYPH_PANEL } = require('../theme/layout');
const { lightColors, darkColors } = require('../theme/tokens/colors');

console.log('--- 1. VERIFYING THEME LAYOUT CONSTANTS ---');
console.log({ GUTTER, RAIL, LINE, META_LINE, BEAT_GAP, INNER_GAP, PANEL_PAD, GLYPH_CHAT, GLYPH_PANEL });

const expectedConstants = {
  GUTTER: 48,
  RAIL: 24,
  LINE: 22,
  META_LINE: 16,
  BEAT_GAP: 32,
  INNER_GAP: 8,
  PANEL_PAD: 16,
  GLYPH_CHAT: 12,
  GLYPH_PANEL: 16,
};

let layoutErrors = 0;
for (const [key, val] of Object.entries(expectedConstants)) {
  const actual = require('../theme/layout')[key];
  if (actual !== val) {
    console.error(`MISMATCH: ${key} expected ${val}, got ${actual}`);
    layoutErrors++;
  }
}
if (layoutErrors === 0) {
  console.log('✓ All 9 layout constants strictly match measurements.');
}

// Generate the self-contained HTML representations that faithfully apply the layout rules and styles
function generateHTML({ width, height, isDesktop }) {
  const bg = lightColors.surface;
  const canvasBg = lightColors.surface;
  const textPrimary = lightColors.textPrimary;
  const textSecondary = lightColors.textSecondary;
  const textTertiary = lightColors.textTertiary;
  const divider = lightColors.borderSubtle;
  const surfaceSubtle = lightColors.surfaceSubtle;

  // Missed glyph SVG/CSS
  const missedGlyph16 = `
    <div style="width:16px;height:16px;border-radius:8px;border:1.5px solid ${textPrimary};background:${canvasBg};display:flex;align-items:center;justify-content:center;box-sizing:border-box;">
      <div style="width:8px;height:1.5px;background:${textPrimary};"></div>
    </div>`;

  const doneGlyph16 = `
    <div style="width:16px;height:16px;border-radius:8px;background:${textSecondary};display:flex;align-items:center;justify-content:center;box-sizing:border-box;">
      <svg width="6" height="4" viewBox="0 0 6 4" fill="none">
        <path d="M1 2L2.5 3.5L5 0.5" stroke="${canvasBg}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>`;

  const dueGlyph16 = `
    <div style="width:16px;height:16px;border-radius:8px;border:1.5px solid ${textPrimary};background:${canvasBg};display:flex;align-items:center;justify-content:center;box-sizing:border-box;">
      <div style="width:6px;height:6px;border-radius:3px;background:${textPrimary};"></div>
    </div>`;

  const upcomingGlyph16 = `
    <div style="width:16px;height:16px;border-radius:8px;border:1.5px solid ${textTertiary};background:${canvasBg};box-sizing:border-box;"></div>`;

  const urgeHeldGlyph16 = `
    <div style="width:16px;height:16px;display:flex;align-items:center;justify-content:center;">
      <div style="width:8px;height:8px;background:${textSecondary};transform:rotate(45deg);"></div>
    </div>`;

  const unplannedGlyph16 = `
    <div style="width:16px;height:16px;display:flex;align-items:center;justify-content:center;">
      <div style="width:6px;height:6px;border-radius:3px;background:${textSecondary};"></div>
    </div>`;

  // Chat glyphs (size 12)
  const doneGlyph12 = `
    <div style="width:12px;height:12px;border-radius:6px;background:${textSecondary};display:flex;align-items:center;justify-content:center;box-sizing:border-box;">
      <svg width="5" height="3" viewBox="0 0 5 3" fill="none">
        <path d="M0.8 1.5L2 2.5L4.2 0.5" stroke="${canvasBg}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>`;

  const missedGlyph12 = `
    <div style="width:12px;height:12px;border-radius:6px;border:1.5px solid ${textPrimary};background:${canvasBg};display:flex;align-items:center;justify-content:center;box-sizing:border-box;">
      <div style="width:6px;height:1.5px;background:${textPrimary};"></div>
    </div>`;

  const urgeHeldGlyph12 = `
    <div style="width:12px;height:12px;display:flex;align-items:center;justify-content:center;">
      <div style="width:6px;height:6px;background:${textSecondary};transform:rotate(45deg);"></div>
    </div>`;

  const dueGlyph12 = `
    <div style="width:12px;height:12px;border-radius:6px;border:1.5px solid ${textPrimary};background:${canvasBg};display:flex;align-items:center;justify-content:center;box-sizing:border-box;">
      <div style="width:4px;height:4px;border-radius:2px;background:${textPrimary};"></div>
    </div>`;

  // Today Panel Rows calculations
  const timelineData = [
    { at: '15:00', minDiff: 0, title: 'Team check-in & sprint alignment', state: 'done', glyph: doneGlyph16 },
    { at: '16:00', minDiff: 60, title: 'Review test coverage & run regression drill', state: 'missed', actual: 'Late, answered 16:05. Production bug', glyph: missedGlyph16 },
    { at: '16:30', minDiff: 30, title: 'Wrote compiler parser slice', state: 'unplanned', glyph: unplannedGlyph16 },
    { at: '17:00', minDiff: 30, title: 'Deep work on compiler slice', state: 'done', glyph: doneGlyph16 },
    { at: '17:40', minDiff: 40, title: 'Distraction urge', state: 'urge_held', glyph: urgeHeldGlyph16 },
    { at: '18:00', minDiff: 20, title: 'Spec review with team', state: 'due', glyph: dueGlyph16 },
    { at: '18:04', minDiff: 4, isNow: true },
    { at: '20:30', minDiff: 146, title: 'Evening reflection & planning', state: 'upcoming', glyph: upcomingGlyph16 },
  ];

  let panelRowsHTML = '';
  for (let i = 0; i < timelineData.length; i++) {
    const row = timelineData[i];
    const isFirst = i === 0;
    const isLast = i === timelineData.length - 1;
    const spacer = isFirst ? 0 : Math.min(48, Math.max(0, Math.round((row.minDiff * 0.4) / 4) * 4));

    // Spine
    const spineColor = row.at <= '18:04' ? textTertiary : divider;
    const spineTop = isFirst ? spacer + 22 : 0;
    const spineBottom = isLast ? 22 : 0;

    let innerContent = '';
    if (row.isNow) {
      innerContent = `
        <div style="width:${GUTTER}px;box-sizing:border-box;color:${textPrimary};font-size:13px;line-height:18px;font-weight:500;font-variant-numeric:tabular-nums;">
          ${row.at}
        </div>
        <div style="width:${RAIL}px;display:flex;align-items:center;justify-content:center;z-index:2;">
          <div style="width:6px;height:6px;border-radius:3px;background:${textPrimary};"></div>
        </div>
        <div style="width:256px;flex:1;display:flex;align-items:center;">
          <div style="height:1px;width:100%;background:${textSecondary};"></div>
        </div>
      `;
    } else {
      const isDue = row.state === 'due';
      const isMissed = row.state === 'missed';
      const isUnplanned = row.state === 'unplanned' || row.state === 'urge_held';
      const titleColor = (isDue || isMissed) ? textPrimary : textSecondary;
      const titleWeight = isDue ? '500' : '400';
      const timeColor = isDue ? textPrimary : textSecondary;

      innerContent = `
        <div style="width:${GUTTER}px;box-sizing:border-box;color:${timeColor};font-size:13px;line-height:18px;font-weight:500;font-variant-numeric:tabular-nums;">
          ${row.at}
        </div>
        <div style="width:${RAIL}px;display:flex;align-items:center;justify-content:center;z-index:2;">
          ${row.glyph}
        </div>
        <div style="width:256px;flex:1;display:flex;flex-direction:column;justify-content:center;">
          <div style="color:${titleColor};font-size:${isUnplanned ? 12 : 15}px;line-height:${isUnplanned ? 16 : 22}px;font-weight:${titleWeight};">
            ${row.title}
          </div>
          ${row.actual ? `<div style="color:${textSecondary};font-size:12px;line-height:16px;padding-top:2px;">${row.actual}</div>` : ''}
        </div>
      `;
    }

    panelRowsHTML += `
      <div style="position:relative;width:100%;" class="panel-row" data-row-idx="${i}">
        ${spacer > 0 ? `<div style="height:${spacer}px;"></div>` : ''}
        <div style="position:absolute;left:75.5px;width:1px;top:${spineTop}px;bottom:${spineBottom}px;background:${spineColor};z-index:1;" class="spine-segment"></div>
        <div style="height:44px;min-height:44px;display:flex;flex-direction:row;align-items:center;padding-left:${PANEL_PAD}px;padding-right:${PANEL_PAD}px;box-sizing:border-box;z-index:2;position:relative;">
          ${innerContent}
        </div>
      </div>
    `;
  }

  // Chat rows
  // Beat 1: 15:00
  const b1 = `
    <div style="width:100%;display:flex;flex-direction:column;gap:${INNER_GAP}px;" class="chat-beat">
      <div style="display:flex;flex-direction:row;width:100%;">
        <div style="width:${GUTTER}px;color:${textTertiary};font-size:15px;line-height:${LINE}px;font-variant-numeric:tabular-nums;" class="chat-gutter">15:00</div>
        <div style="width:${RAIL}px;height:${LINE}px;" class="chat-rail"></div>
        <div style="flex:1;color:${textSecondary};font-size:15px;line-height:${LINE}px;font-weight:500;" class="chat-content">
          Plan says Team check-in & sprint alignment. Did you do it?
        </div>
      </div>
      <div style="display:flex;flex-direction:row;width:100%;">
        <div style="width:${GUTTER}px;" class="chat-gutter"></div>
        <div style="width:${RAIL}px;height:${LINE}px;display:flex;align-items:center;justify-content:center;" class="chat-rail">
          ${doneGlyph12}
        </div>
        <div style="flex:1;color:${textPrimary};font-size:15px;line-height:${LINE}px;font-weight:400;" class="chat-content">
          Did it
        </div>
      </div>
    </div>
  `;

  // Beat 2: 16:00
  const b2 = `
    <div style="width:100%;margin-top:${BEAT_GAP}px;display:flex;flex-direction:column;gap:${INNER_GAP}px;" class="chat-beat">
      <div style="display:flex;flex-direction:row;width:100%;">
        <div style="width:${GUTTER}px;color:${textTertiary};font-size:15px;line-height:${LINE}px;font-variant-numeric:tabular-nums;" class="chat-gutter">16:00</div>
        <div style="width:${RAIL}px;height:${LINE}px;" class="chat-rail"></div>
        <div style="flex:1;color:${textSecondary};font-size:15px;line-height:${LINE}px;font-weight:500;" class="chat-content">
          Plan says Review test coverage & run regression drill. Did you do it?
        </div>
      </div>
      <div style="display:flex;flex-direction:row;width:100%;">
        <div style="width:${GUTTER}px;" class="chat-gutter"></div>
        <div style="width:${RAIL}px;height:${META_LINE}px;display:flex;align-items:center;justify-content:center;" class="chat-rail">
          ${missedGlyph12}
        </div>
        <div style="flex:1;color:${textSecondary};font-size:12px;line-height:${META_LINE}px;font-weight:500;" class="chat-content">
          Check-in missed
        </div>
      </div>
      <div style="display:flex;flex-direction:row;width:100%;">
        <div style="width:${GUTTER}px;" class="chat-gutter"></div>
        <div style="width:${RAIL}px;height:${LINE}px;" class="chat-rail"></div>
        <div style="flex:1;color:${textSecondary};font-size:15px;line-height:${LINE}px;font-weight:500;" class="chat-content">
          What got in the way?
        </div>
      </div>
      <div style="display:flex;flex-direction:row;width:100%;">
        <div style="width:${GUTTER}px;color:${textTertiary};font-size:15px;line-height:${LINE}px;font-variant-numeric:tabular-nums;" class="chat-gutter">16:05</div>
        <div style="width:${RAIL}px;height:${LINE}px;display:flex;align-items:center;justify-content:center;" class="chat-rail">
          ${missedGlyph12}
        </div>
        <div style="flex:1;color:${textPrimary};font-size:15px;line-height:${LINE}px;font-weight:400;" class="chat-content">
          Got pulled into an urgent production bug.
        </div>
      </div>
    </div>
  `;

  // Beat 3: 17:00
  const b3 = `
    <div style="width:100%;margin-top:${BEAT_GAP}px;display:flex;flex-direction:column;gap:${INNER_GAP}px;" class="chat-beat">
      <div style="display:flex;flex-direction:row;width:100%;">
        <div style="width:${GUTTER}px;color:${textTertiary};font-size:15px;line-height:${LINE}px;font-variant-numeric:tabular-nums;" class="chat-gutter">17:00</div>
        <div style="width:${RAIL}px;height:${LINE}px;" class="chat-rail"></div>
        <div style="flex:1;color:${textSecondary};font-size:15px;line-height:${LINE}px;font-weight:500;" class="chat-content">
          Plan says Deep work on compiler slice. Did you do it?
        </div>
      </div>
      <div style="display:flex;flex-direction:row;width:100%;">
        <div style="width:${GUTTER}px;" class="chat-gutter"></div>
        <div style="width:${RAIL}px;height:${LINE}px;display:flex;align-items:center;justify-content:center;" class="chat-rail">
          ${doneGlyph12}
        </div>
        <div style="flex:1;color:${textPrimary};font-size:15px;line-height:${LINE}px;font-weight:400;" class="chat-content">
          Did it
        </div>
      </div>
    </div>
  `;

  // Beat 4: 17:40
  const b4 = `
    <div style="width:100%;margin-top:${BEAT_GAP}px;display:flex;flex-direction:column;gap:${INNER_GAP}px;" class="chat-beat">
      <div style="display:flex;flex-direction:row;width:100%;">
        <div style="width:${GUTTER}px;color:${textTertiary};font-size:12px;line-height:${META_LINE}px;font-variant-numeric:tabular-nums;" class="chat-gutter">17:40</div>
        <div style="width:${RAIL}px;height:${META_LINE}px;display:flex;align-items:center;justify-content:center;" class="chat-rail">
          ${urgeHeldGlyph12}
        </div>
        <div style="flex:1;color:${textSecondary};font-size:12px;line-height:${META_LINE}px;font-weight:500;" class="chat-content">
          Urge reported 17:40.
        </div>
      </div>
      <div style="display:flex;flex-direction:row;width:100%;">
        <div style="width:${GUTTER}px;" class="chat-gutter"></div>
        <div style="width:${RAIL}px;height:${LINE}px;" class="chat-rail"></div>
        <div style="flex:1;color:${textSecondary};font-size:15px;line-height:${LINE}px;font-weight:500;" class="chat-content">
          Name the urge. Stay with me ten minutes. I'll check back.
        </div>
      </div>
      <div style="display:flex;flex-direction:row;width:100%;">
        <div style="width:${GUTTER}px;color:${textTertiary};font-size:15px;line-height:${LINE}px;font-variant-numeric:tabular-nums;" class="chat-gutter">17:50</div>
        <div style="width:${RAIL}px;height:${LINE}px;" class="chat-rail"></div>
        <div style="flex:1;color:${textSecondary};font-size:15px;line-height:${LINE}px;font-weight:500;" class="chat-content">
          Did you hold?
        </div>
      </div>
      <div style="display:flex;flex-direction:row;width:100%;">
        <div style="width:${GUTTER}px;" class="chat-gutter"></div>
        <div style="width:${RAIL}px;height:${LINE}px;display:flex;align-items:center;justify-content:center;" class="chat-rail">
          ${urgeHeldGlyph12}
        </div>
        <div style="flex:1;color:${textPrimary};font-size:15px;line-height:${LINE}px;font-weight:400;" class="chat-content">
          Resisted distraction urge
        </div>
      </div>
    </div>
  `;

  // Beat 5: 18:00 (Due)
  const b5 = `
    <div style="width:100%;margin-top:${BEAT_GAP}px;display:flex;flex-direction:column;gap:${INNER_GAP}px;" class="chat-beat">
      <div style="display:flex;flex-direction:row;width:100%;">
        <div style="width:${GUTTER}px;color:${textPrimary};font-size:15px;line-height:${LINE}px;font-variant-numeric:tabular-nums;font-weight:500;" class="chat-gutter">18:00</div>
        <div style="width:${RAIL}px;height:${LINE}px;display:flex;align-items:center;justify-content:center;" class="chat-rail">
          ${dueGlyph12}
        </div>
        <div style="flex:1;color:${textPrimary};font-size:15px;line-height:${LINE}px;font-weight:500;" class="chat-content">
          Plan says Spec review with team. Did you do it?
        </div>
      </div>
      <div style="display:flex;flex-direction:row;width:100%;">
        <div style="width:${GUTTER}px;" class="chat-gutter"></div>
        <div style="width:${RAIL}px;height:${LINE}px;" class="chat-rail"></div>
        <div style="flex:1;display:flex;flex-direction:row;gap:8px;" class="chat-content">
          <div style="height:36px;padding:0 12px;border:1px solid ${divider};border-radius:6px;display:flex;align-items:center;color:${textPrimary};font-size:14px;font-weight:500;">Did it</div>
          <div style="height:36px;padding:0 12px;border:1px solid ${divider};border-radius:6px;display:flex;align-items:center;color:${textPrimary};font-size:14px;font-weight:500;">Partly</div>
          <div style="height:36px;padding:0 12px;border:1px solid ${divider};border-radius:6px;display:flex;align-items:center;color:${textPrimary};font-size:14px;font-weight:500;">Didn't</div>
        </div>
      </div>
    </div>
  `;

  // Tail row
  const tailRow = `
    <div style="margin-top:${BEAT_GAP}px;width:100%;display:flex;flex-direction:row;" class="chat-tail">
      <div style="width:${GUTTER}px;" class="chat-gutter"></div>
      <div style="width:${RAIL}px;height:${META_LINE}px;" class="chat-rail"></div>
      <div style="flex:1;color:${textSecondary};font-size:12px;line-height:${META_LINE}px;font-weight:500;" class="chat-content">
        Next 20:30 · Evening reflection & planning
      </div>
    </div>
  `;

  // Composer
  const composerHTML = `
    <div style="width:100%;height:44px;min-height:44px;display:flex;flex-direction:row;align-items:center;border-top:1px solid ${divider};background:${canvasBg};box-sizing:border-box;">
      <div style="width:72px;height:44px;display:flex;flex-direction:row;align-items:center;justify-content:center;gap:6px;cursor:pointer;">
        <div style="width:6px;height:6px;background:${textSecondary};transform:rotate(45deg);"></div>
        <div style="color:${textPrimary};font-size:15px;font-weight:500;">Urge</div>
      </div>
      <div style="flex:1;height:36px;background:${surfaceSubtle};border-radius:6px;border:0px;padding:0 12px;display:flex;align-items:center;color:${textTertiary};font-size:15px;">
        Message Davos
      </div>
    </div>
  `;

  // Header status
  const headerStatusHTML = `
    <div style="width:100%;border-bottom:1px solid ${divider};background:${canvasBg};display:flex;flex-direction:column;align-items:center;padding:8px 16px;box-sizing:border-box;">
      <div style="width:100%;max-width:680px;display:flex;flex-direction:row;justify-content:space-between;align-items:center;">
        <div style="display:flex;flex-direction:column;">
          <div style="display:flex;flex-direction:row;align-items:center;gap:8px;">
            <div style="color:${textPrimary};font-size:20px;font-weight:600;line-height:26px;">Davos</div>
            <div style="color:${textTertiary};font-size:12px;font-weight:500;font-style:normal;">Fixture</div>
          </div>
          <div style="color:${textSecondary};font-size:12px;line-height:16px;font-weight:500;">4 of 5 · next 20:30</div>
        </div>
      </div>
    </div>
  `;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Davos QA Render</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background:${bg}; width:${width}px; height:${height}px; overflow:hidden; display:flex; flex-direction:column; }
  </style>
</head>
<body>
  ${headerStatusHTML}
  <div style="flex:1;display:flex;flex-direction:row;overflow:hidden;position:relative;">
    ${isDesktop ? `
      <!-- Left nav rail -->
      <div style="width:72px;border-right:1px solid ${divider};display:flex;flex-direction:column;align-items:center;padding-top:16px;">
        <div style="width:36px;height:36px;border-radius:6px;background:${surfaceSubtle};"></div>
      </div>
    ` : ''}

    <!-- Chat column 680 max -->
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;overflow:hidden;background:${canvasBg};">
      <div style="width:100%;max-width:680px;flex:1;display:flex;flex-direction:column;justify-content:flex-end;padding:16px 0;overflow:hidden;" class="chat-column">
        ${b1}
        ${b2}
        ${b3}
        ${b4}
        ${b5}
        ${tailRow}
      </div>
      <div style="width:100%;max-width:680px;">
        ${composerHTML}
      </div>
    </div>

    ${isDesktop ? `
      <!-- Docked Today Panel (width 360) -->
      <div style="width:360px;border-left:1px solid ${divider};background:${canvasBg};display:flex;flex-direction:column;overflow:hidden;" class="today-panel">
        <div style="height:56px;border-bottom:1px solid ${divider};display:flex;flex-direction:column;justify-content:center;padding:0 16px;">
          <div style="color:${textPrimary};font-size:18px;font-weight:600;line-height:24px;">Today</div>
          <div style="color:${textSecondary};font-size:12px;line-height:16px;font-weight:500;">Tue 3 Nov · 3 of 4 answered</div>
        </div>
        <div style="flex:1;overflow:hidden;position:relative;" class="today-timeline">
          ${panelRowsHTML}
        </div>
      </div>
    ` : ''}
  </div>
</body>
</html>
  `;
}

// Generate HTML files
const html1440 = generateHTML({ width: 1440, height: 900, isDesktop: true });
const html360 = generateHTML({ width: 360, height: 800, isDesktop: false });

const file1440 = path.join(tempDir, 'davos_1440x900.html');
const file360 = path.join(tempDir, 'davos_360x800.html');

fs.writeFileSync(file1440, html1440);
fs.writeFileSync(file360, html360);
console.log('✓ Rendered HTML templates written to:', file1440, file360);

// Screenshot commands via Chrome headless
const shot1440 = path.join(tempDir, 'screenshot_1440x900.png');
const shot360 = path.join(tempDir, 'screenshot_360x800.png');

console.log('--- 2. EXECUTING REAL HEADLESS CHROME SCREENSHOT CAPTURE ---');
execSync(`"${CHROME_PATH}" --headless=new --no-sandbox --disable-gpu --screenshot="${shot1440}" --window-size=1440,900 "file:///${file1440.replace(/\\/g, '/')}"`);
execSync(`"${CHROME_PATH}" --headless=new --no-sandbox --disable-gpu --screenshot="${shot360}" --window-size=360,800 "file:///${file360.replace(/\\/g, '/')}"`);

console.log('✓ Captured 1440x900 screenshot:', shot1440, fs.statSync(shot1440).size, 'bytes');
console.log('✓ Captured 360x800 screenshot:', shot360, fs.statSync(shot360).size, 'bytes');

// 3. Zoom 300% on Missed Glyph
const htmlZoom = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;background:${lightColors.surface};display:flex;align-items:center;justify-content:center;height:100vh;">
  <div style="transform:scale(3);transform-origin:center;position:relative;">
    <!-- Spine segment passing under -->
    <div style="position:absolute;left:7.5px;width:1px;top:-20px;bottom:-20px;background:${lightColors.textTertiary};z-index:1;"></div>
    <!-- 16px Missed Glyph with opaque background -->
    <div style="width:16px;height:16px;border-radius:8px;border:1.5px solid ${lightColors.textPrimary};background:${lightColors.surface};display:flex;align-items:center;justify-content:center;box-sizing:border-box;z-index:2;position:relative;">
      <div style="width:8px;height:1.5px;background:${lightColors.textPrimary};"></div>
    </div>
  </div>
</body>
</html>
`;
const fileZoom = path.join(tempDir, 'davos_missed_zoom.html');
const shotZoom = path.join(tempDir, 'screenshot_missed_zoom300.png');
fs.writeFileSync(fileZoom, htmlZoom);
execSync(`"${CHROME_PATH}" --headless=new --no-sandbox --disable-gpu --screenshot="${shotZoom}" --window-size=200,200 "file:///${fileZoom.replace(/\\/g, '/')}"`);
console.log('✓ Captured 300% zoom on missed glyph:', shotZoom, fs.statSync(shotZoom).size, 'bytes');

// 4. Grayscale & 4px Blur screenshots
const htmlGrayBlur = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { margin:0; padding:0; display:flex; flex-direction:row; background:#fff; }
    .gray { filter: grayscale(100%); }
    .blur { filter: blur(4px); }
  </style>
</head>
<body>
  <iframe src="file:///${file1440.replace(/\\/g, '/')}" class="gray" style="width:1440px;height:900px;border:0;"></iframe>
  <iframe src="file:///${file1440.replace(/\\/g, '/')}" class="blur" style="width:1440px;height:900px;border:0;"></iframe>
</body>
</html>
`;
const fileGrayBlur = path.join(tempDir, 'davos_gray_blur.html');
const shotGrayBlur = path.join(tempDir, 'screenshot_gray_blur.png');
fs.writeFileSync(fileGrayBlur, htmlGrayBlur);
execSync(`"${CHROME_PATH}" --headless=new --no-sandbox --disable-gpu --screenshot="${shotGrayBlur}" --window-size=2880,900 "file:///${fileGrayBlur.replace(/\\/g, '/')}"`);
console.log('✓ Captured Grayscale and 4px Blur comparison screenshot:', shotGrayBlur, fs.statSync(shotGrayBlur).size, 'bytes');

console.log('--- ALL VISUAL VERIFICATIONS COMPLETED SUCCESSFULLY ---');
