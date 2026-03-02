with open('/Users/wilsonwye/.openclaw/workspace/roast-prototype/index.html', 'r') as f:
    html = f.read()

# ── Replace entire form overlay CSS with stripped-back version ──
old = '''    #form-overlay {
      display: none;
      position: fixed; inset: 0; z-index: 900;
      background: #0a0a0a;
      background-image: radial-gradient(ellipse 50% 45% at 15% 100%, rgba(100,0,0,0.22) 0%, transparent 55%),
                        radial-gradient(ellipse 50% 45% at 85% 100%, rgba(100,0,0,0.18) 0%, transparent 55%);
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 60px 24px 100px;
    }'''
new = '''    #form-overlay {
      display: none;
      position: fixed; inset: 0; z-index: 900;
      background: #000;
      background-image: radial-gradient(ellipse 55% 50% at 100% 100%, rgba(100,0,0,0.35) 0%, transparent 60%);
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }'''
html = html.replace(old, new)

# ── Replace fo-steps and fo-step styling ──
old2 = '''    .fo-steps { width: 100%; max-width: 540px; }

    .fo-step {
      display: none;
      flex-direction: column;
      animation: slideUp 0.38s ease;
    }
    .fo-step.active { display: flex; }'''
new2 = '''    .fo-steps { width: 100%; max-width: 480px; }

    .fo-step {
      display: none;
      flex-direction: column;
      align-items: stretch;
      animation: slideUp 0.38s ease;
    }
    .fo-step.active { display: flex; }'''
html = html.replace(old2, new2)

# ── Remove fo-step-num, fo-progress-label, fo-prog-bar, fo-hint styles (replace with empty) ──
old3 = '''    .fo-step-num {
      font-size: 11px; font-weight: 600;
      letter-spacing: 0.1em; text-transform: uppercase;
      color: rgba(255,255,255,0.3); margin-bottom: 12px;
      display: flex; align-items: center; justify-content: space-between;
    }
    .fo-progress-label {
      width: 100%;
      margin-bottom: 22px;
    }
    .fo-prog-bar {
      height: 2px; background: rgba(255,255,255,0.08);
      border-radius: 100px; overflow: hidden; margin-top: 6px;
    }
    .fo-prog-bar-fill {
      height: 100%; background: var(--red);
      border-radius: 100px; transition: width 0.4s ease;
    }'''
new3 = ''
html = html.replace(old3, new3)

# ── Fix fo-q to match applier size ──
old4 = '''    .fo-q {
      font-size: clamp(20px, 2.8vw, 28px);
      font-weight: 700; letter-spacing: -0.015em;
      line-height: 1.3; margin-bottom: 28px;
      color: rgba(255,255,255,0.92);
    }'''
new4 = '''    .fo-q {
      font-size: clamp(22px, 3vw, 30px);
      font-weight: 800; letter-spacing: -0.02em;
      line-height: 1.25; margin-bottom: 24px;
      color: #fff;
      text-align: center;
    }'''
html = html.replace(old4, new4)

# ── Fix fo-input to match: full-width, red border ──
old5 = '''    .fo-input {
      width: 100%;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 10px;
      color: #fff;
      font-size: clamp(16px, 2.2vw, 20px);
      font-family: \'Inter\', sans-serif;
      font-weight: 400;
      padding: 16px 20px;
      outline: none;
      transition: border-color 0.2s, background 0.2s;
      caret-color: var(--red);
    }
    .fo-input::placeholder { color: rgba(255,255,255,0.2); font-weight: 400; }
    .fo-input:focus { border-color: rgba(255,255,255,0.3); background: rgba(255,255,255,0.06); }'''
new5 = '''    .fo-input {
      width: 100%;
      background: transparent;
      border: 1.5px solid rgba(180,0,0,0.7);
      border-radius: 8px;
      color: #fff;
      font-size: 17px;
      font-family: \'Inter\', sans-serif;
      font-weight: 400;
      padding: 16px 18px;
      outline: none;
      text-align: center;
      transition: border-color 0.2s;
      caret-color: var(--red);
      margin-bottom: 10px;
    }
    .fo-input::placeholder { color: rgba(255,255,255,0.25); }
    .fo-input:focus { border-color: var(--red); }'''
html = html.replace(old5, new5)

# ── Fix fo-btn to be full-width ──
old6 = '''    .fo-btn {
      display: inline-flex; align-items: center; gap: 9px;
      background: var(--red);
      color: #fff; font-size: 15px; font-weight: 700;
      padding: 12px 26px; border: none; border-radius: 8px;
      cursor: pointer;
      box-shadow: 0 4px 28px rgba(217,30,30,0.32);
      transition: transform 0.15s, box-shadow 0.15s, opacity 0.15s;
      letter-spacing: -0.01em;
    }
    .fo-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 36px rgba(217,30,30,0.46); }
    .fo-btn:disabled { opacity: 0.35; pointer-events: none; }

    /* Pinned bottom bar */
    .fo-bottom-bar {
      position: fixed; bottom: 0; left: 0; right: 0;
      padding: 18px 32px;
      display: flex; align-items: center; justify-content: space-between;
      border-top: 1px solid rgba(255,255,255,0.06);
      background: rgba(10,10,10,0.95);
      backdrop-filter: blur(8px);
      z-index: 902;
    }
    .fo-back-btn {
      background: none; border: none; color: rgba(255,255,255,0.35);
      font-size: 14px; font-weight: 500; cursor: pointer;
      display: flex; align-items: center; gap: 6px;
      font-family: \'Inter\', sans-serif;
      padding: 8px 0;
      transition: color 0.15s;
    }
    .fo-back-btn:hover { color: rgba(255,255,255,0.7); }'''
new6 = '''    .fo-btn {
      display: flex; align-items: center; justify-content: center; gap: 9px;
      width: 100%;
      background: rgba(140,0,0,0.85);
      color: rgba(255,255,255,0.5); font-size: 16px; font-weight: 600;
      padding: 16px 20px; border: none; border-radius: 8px;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
      letter-spacing: 0.01em;
    }
    .fo-btn:hover { background: var(--red); color: #fff; }
    .fo-btn.ready { background: var(--red); color: #fff; }
    .fo-btn:disabled { opacity: 0.3; pointer-events: none; }'''
html = html.replace(old6, new6)

# ── Remove fo-hint style (already gone) and fo-error style - keep but smaller ──
old7 = '''    .fo-error {
      font-size: 12px; color: #ff6b6b;
      margin-top: 8px; min-height: 18px;
      font-weight: 500;
    }
    .fo-hint { margin-top: 14px; font-size: 12px; color: rgba(255,255,255,0.25); }
    kbd { background: rgba(255,255,255,0.08); border-radius: 4px; padding: 1px 6px; font-size: 11px; font-family: inherit; }'''
new7 = '''    .fo-error {
      font-size: 12px; color: #ff6b6b;
      margin-top: 6px; min-height: 16px;
      font-weight: 500; text-align: center;
    }'''
html = html.replace(old7, new7)

with open('/Users/wilsonwye/.openclaw/workspace/roast-prototype/index.html', 'w') as f:
    f.write(html)
print("done")
