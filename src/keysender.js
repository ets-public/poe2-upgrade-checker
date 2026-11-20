'use strict';

// Sends a single Ctrl+C keystroke to the game on Windows. If one of this app's own windows is in
// front (you clicked the results window or the main window), the game is brought back to the
// front first, otherwise the copy would go to our window and nothing would be copied. Uses one long-running PowerShell process so each press is fast,
// instead of starting PowerShell every time. No native modules needed.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// The Windows helper's C#: window checks and the one Ctrl+C. Compiled into poekeys.exe when the app is
// built (tools/get-pob.js, with the C# compiler that ships with Windows), and run from there. If that
// .exe is missing (running from source without a build), PowerShell compiles the same code at start.
const CS_SOURCE = String.raw`using System;
using System.Runtime.InteropServices;
public static class PoeKeys {
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint mapType);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
  // the window title tells PoE1 ("Path of Exile") from PoE2 ("Path of Exile 2"): both use the same exe names
  static string Title(IntPtr h) { var sb = new System.Text.StringBuilder(256); GetWindowText(h, sb, 256); return sb.ToString().Replace(";", ","); }
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("advapi32.dll")] static extern bool OpenProcessToken(IntPtr h, uint access, out IntPtr token);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  // a game started "as administrator" doesn't take keystrokes from a normal app (Windows blocks
  // them); we can tell because we may not even look at its process token
  static bool Elevated(uint pid) {
    IntPtr h = OpenProcess(0x1000, false, pid); if (h == IntPtr.Zero) return false;
    IntPtr t; bool ok = OpenProcessToken(h, 0x0008, out t);
    if (ok) CloseHandle(t); CloseHandle(h);
    return !ok;
  }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  static string ProcName(uint pid) { try { return System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch { return "?"; } }
  static bool IsGame(string name) { return name.StartsWith("PathOfExile", StringComparison.OrdinalIgnoreCase); }
  static IntPtr FindGame() {
    foreach (var p in System.Diagnostics.Process.GetProcesses()) {
      if (!IsGame(p.ProcessName)) continue;
      IntPtr h = p.MainWindowHandle; if (h != IntPtr.Zero && !IsIconic(h)) return h;
    }
    return IntPtr.Zero;
  }
  static bool Focus(IntPtr h, uint fgThread) {
    uint me = GetCurrentThreadId();
    AttachThreadInput(me, fgThread, true);
    BringWindowToTop(h); bool ok = SetForegroundWindow(h);
    AttachThreadInput(me, fgThread, false);
    return ok;
  }
  // Before the keystroke: make sure it reaches the game, with the item under the mouse hovered.
  //  - the game isn't the active window, but this app is, or the mouse is over the game (you clicked
  //    the results window, or Discord has focus): bring the game to the front
  //  - nudge: the app just hid its popup from under the mouse, so move the mouse 1 pixel and back
  //    for the game to see the item under it again (and show its tooltip)
  // Returns "fg=<process the keystroke goes to>;over=<process under the mouse>[;refocused][;nudged][;title=<game window title>]".
  public static string Prepare(int appPid, bool nudge) {
    IntPtr fg = GetForegroundWindow(); uint fgPid; uint fgThread = GetWindowThreadProcessId(fg, out fgPid);
    string fgName = ProcName(fgPid);
    POINT pt; GetCursorPos(out pt);
    IntPtr under = GetAncestor(WindowFromPoint(pt), 2); uint underPid; GetWindowThreadProcessId(under, out underPid);
    string underName = ProcName(underPid);
    string extra = "";
    if (nudge) { SetCursorPos(pt.X + 1, pt.Y); System.Threading.Thread.Sleep(20); SetCursorPos(pt.X, pt.Y); extra += ";nudged"; }
    if (!IsGame(fgName) && (fgPid == (uint)appPid || IsGame(underName))) {
      IntPtr game = IsGame(underName) ? under : FindGame();
      if (game != IntPtr.Zero && Focus(game, fgThread)) {
        IntPtr now = GetForegroundWindow(); uint nowPid; GetWindowThreadProcessId(now, out nowPid);
        fgName = ProcName(nowPid); extra += ";refocused";
        System.Threading.Thread.Sleep(90); // let the game take the focus before the keystroke
      } else extra += ";refocus-failed";
    }
    if (nudge) System.Threading.Thread.Sleep(70); // the game redraws the tooltip
    IntPtr f2 = GetForegroundWindow(); uint f2Pid; GetWindowThreadProcessId(f2, out f2Pid);
    bool f2Game = IsGame(ProcName(f2Pid));
    if (f2Game && Elevated(f2Pid)) extra += ";game-admin";
    IntPtr titled = f2Game ? f2 : (IsGame(underName) ? under : IntPtr.Zero);
    if (titled != IntPtr.Zero) extra += ";title=" + Title(titled);
    return "fg=" + fgName + ";over=" + underName + extra;
  }
  const uint UP = 2;
  static bool Down(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }
  // Send with the hardware scan code and hold each key briefly: games read the
  // keyboard once per frame, so a press that is down and up within microseconds
  // can be missed (that's why every other hotkey press did nothing).
  static void Key(byte vk, bool up) { keybd_event(vk, (byte)MapVirtualKey(vk, 0), up ? UP : 0, UIntPtr.Zero); }
  public static void Copy(bool advanced) {
    if (Down(0x10)) Key(0x10, true);                // let go of Shift
    bool alt = Down(0x12);
    if (alt && !advanced) Key(0x12, true);          // let go of Alt (from an Alt+ hotkey)
    Key(0x11, false); System.Threading.Thread.Sleep(15);         // Ctrl down
    if (advanced && !alt) { Key(0x12, false); System.Threading.Thread.Sleep(15); }
    Key(0x43, false); System.Threading.Thread.Sleep(40);         // C down (held ~2 frames)
    Key(0x43, true);  System.Threading.Thread.Sleep(15);         // C up
    if (advanced && !alt) Key(0x12, true);
    Key(0x11, true);                                 // Ctrl up
  }
}
`;

// the check before every keystroke, the same in poekeys.exe and the PowerShell fallback: only ever press
// Ctrl+C in the game (in another window it would copy, or in a terminal interrupt, something else).
// "?" (a window whose process we can't name) only counts when the mouse is over the game.
const CS_MAIN = String.raw`
public static class PoeKeysMain {
  public static bool IsGameTarget(string t) {
    return System.Text.RegularExpressions.Regex.IsMatch(t, "^fg=PathOfExile[^;]*;") || t.StartsWith("fg=?;over=PathOfExile");
  }
  public static int Main() {
    Console.Out.WriteLine("ready"); Console.Out.Flush();
    string line;
    while ((line = Console.In.ReadLine()) != null) {
      try {
        string[] parts = line.Split(' ');
        int pid = 0; if (parts.Length > 1) int.TryParse(parts[1], out pid);
        string target = PoeKeys.Prepare(pid, parts.Length > 2 && parts[2] == "nudge");
        if (IsGameTarget(target)) PoeKeys.Copy(parts[0] == "advanced"); else target += ";skipped";
        Console.Out.WriteLine("ok " + target);
      } catch (Exception e) { Console.Out.WriteLine("err " + e.Message.Replace('\r', ' ').Replace('\n', ' ')); }
      Console.Out.Flush();
    }
    return 0;
  }
}
`;

const PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
${CS_SOURCE}
${CS_MAIN}
"@
[Console]::Out.WriteLine('ready')
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  try {
    $parts = $line.Split(' ')
    $target = [PoeKeys]::Prepare([int]($(if ($parts.Count -gt 1) { $parts[1] } else { 0 })), ($parts.Count -gt 2 -and $parts[2] -eq 'nudge'))
    # only ever press Ctrl+C in the game (the same check as poekeys.exe)
    if ([PoeKeysMain]::IsGameTarget($target)) { [PoeKeys]::Copy($parts[0] -eq 'advanced') } else { $target += ';skipped' }
    [Console]::Out.WriteLine('ok ' + $target)
  } catch { [Console]::Out.WriteLine('err ' + $_.Exception.Message) }
}
`;

// Linux: the same job for the game under Proton (an X11 window, also on Wayland desktops via
// XWayland), with XTest through Python's ctypes, so there's nothing to install.
const PY_SCRIPT = String.raw`# PoE Upgrade Checker - Linux key helper (X11 / XWayland, via XTest; no installs needed).
# Reads one command per line: "copy <app pid> [nudge]" or "advanced <app pid> [nudge]".
# Answers "ok fg=<window that got the keystroke>;over=<window under the mouse>[;refocused|;refocus-failed][;nudged]"
# The game runs under Proton/Wine as an X11 window, so this works on X11 and on Wayland desktops.
import ctypes, os, sys, time
from ctypes import c_int, c_uint, c_ulong, c_long, c_char_p, c_void_p, POINTER, byref, Structure, Union

def out(s):
    sys.stdout.write(s + '\n'); sys.stdout.flush()

try:
    X = ctypes.CDLL('libX11.so.6'); T = ctypes.CDLL('libXtst.so.6')
except OSError as e:
    out('fatal X11/XTest libraries not found (%s)' % e); sys.exit(2)
Window = c_ulong; Atom = c_ulong
X.XOpenDisplay.restype = c_void_p; X.XOpenDisplay.argtypes = [c_char_p]
d = X.XOpenDisplay(None)
if not d:
    out('fatal cannot open the X display (DISPLAY=%s)' % os.environ.get('DISPLAY')); sys.exit(3)
ERRH = ctypes.CFUNCTYPE(c_int, c_void_p, c_void_p)(lambda a, b: 0)  # ignore BadWindow etc.
X.XSetErrorHandler(ERRH)
X.XDefaultRootWindow.restype = Window; X.XDefaultRootWindow.argtypes = [c_void_p]
root = X.XDefaultRootWindow(d)
X.XKeysymToKeycode.restype = ctypes.c_ubyte; X.XKeysymToKeycode.argtypes = [c_void_p, c_ulong]
X.XInternAtom.restype = Atom; X.XInternAtom.argtypes = [c_void_p, c_char_p, c_int]
X.XGetWindowProperty.argtypes = [c_void_p, Window, Atom, c_long, c_long, c_int, Atom, POINTER(Atom), POINTER(c_int), POINTER(c_ulong), POINTER(c_ulong), POINTER(c_void_p)]
X.XFree.argtypes = [c_void_p]
X.XQueryPointer.argtypes = [c_void_p, Window, POINTER(Window), POINTER(Window), POINTER(c_int), POINTER(c_int), POINTER(c_int), POINTER(c_int), POINTER(c_uint)]
X.XQueryKeymap.argtypes = [c_void_p, ctypes.c_char * 32]
X.XFlush.argtypes = [c_void_p]
X.XGetInputFocus.argtypes = [c_void_p, POINTER(Window), POINTER(c_int)]
T.XTestFakeKeyEvent.argtypes = [c_void_p, c_uint, c_int, c_ulong]
T.XTestFakeRelativeMotionEvent.argtypes = [c_void_p, c_int, c_int, c_ulong]
class XClassHint(Structure):
    _fields_ = [('res_name', c_void_p), ('res_class', c_void_p)]
X.XGetClassHint.argtypes = [c_void_p, Window, POINTER(XClassHint)]
class XClientMessageEvent(Structure):
    _fields_ = [('type', c_int), ('serial', c_ulong), ('send_event', c_int), ('display', c_void_p), ('window', Window), ('message_type', Atom), ('format', c_int), ('l', c_long * 5)]
class XEvent(Union):
    _fields_ = [('xclient', XClientMessageEvent), ('pad', c_long * 24)]
X.XSendEvent.argtypes = [c_void_p, Window, c_int, c_long, POINTER(XEvent)]
X.XSetInputFocus.argtypes = [c_void_p, Window, c_int, c_ulong]
X.XRaiseWindow.argtypes = [c_void_p, Window]

KC = lambda sym: X.XKeysymToKeycode(d, sym)
CTRL, ALT, C = KC(0xffe3), KC(0xffe9), KC(0x0063)
def codes(*syms):
    return [k for k in dict.fromkeys(KC(s) for s in syms) if k]
SHIFTS = codes(0xffe1, 0xffe2)                                   # Shift_L, Shift_R
ALTGR = codes(0xfe03)                                            # ISO_Level3_Shift (AltGr)
ALTS = [k for k in codes(0xffe9, 0xffea) if k not in ALTGR]      # Alt_L, Alt_R
GAME_HINTS = ('pathofexile', 'steam_app_2694490', 'steam_app_238960')  # the window class under Proton: PoE2 is Steam app 2694490, PoE1 238960

def prop(w, name):
    a = X.XInternAtom(d, name.encode(), 0); at = Atom(); af = c_int(); n = c_ulong(); rest = c_ulong(); data = c_void_p()
    if X.XGetWindowProperty(d, w, a, 0, 16, 0, 0, byref(at), byref(af), byref(n), byref(rest), byref(data)) != 0 or not data.value:
        return None
    try:
        if n.value == 0 or af.value != 32: return None
        arr = ctypes.cast(data, POINTER(c_ulong)); return [arr[i] for i in range(n.value)]
    finally:
        X.XFree(data)

def wm_class(w):
    h = XClassHint()
    if not w or not X.XGetClassHint(d, w, byref(h)): return ''
    s = ''
    for p in (h.res_name, h.res_class):
        if p: s += ctypes.string_at(p).decode('utf8', 'replace') + ' '; X.XFree(p)
    return s.strip()

def pid_of(w):
    v = prop(w, '_NET_WM_PID') if w else None
    return v[0] if v else 0

def comm(pid):
    try:
        with open('/proc/%d/comm' % pid) as f: return f.read().strip()
    except Exception: return ''

def is_game(w):
    s = (wm_class(w) + ' ' + comm(pid_of(w))).lower()
    return any(h in s for h in GAME_HINTS)

def title(w):
    # _NET_WM_NAME (UTF-8), else WM_NAME
    for name in ('_NET_WM_NAME', 'WM_NAME'):
        a = X.XInternAtom(d, name.encode(), 0); at = Atom(); af = c_int(); n = c_ulong(); rest = c_ulong(); data = c_void_p()
        if X.XGetWindowProperty(d, w, a, 0, 256, 0, 0, byref(at), byref(af), byref(n), byref(rest), byref(data)) == 0 and data.value:
            try:
                if af.value == 8 and n.value: return ctypes.string_at(data, n.value).decode('utf8', 'replace')
            finally:
                X.XFree(data)
    return ''

def which_game(w):
    # PoE1 or PoE2: the Steam app id in the window class under Proton, else the exact window title
    c = wm_class(w).lower()
    if 'steam_app_2694490' in c: return 'poe2'
    if 'steam_app_238960' in c: return 'poe1'
    t = title(w).strip()
    return 'poe2' if t == 'Path of Exile 2' else 'poe1' if t == 'Path of Exile' else ''

def describe(w, app_pid):
    if not w: return '?'
    p = pid_of(w)
    if p and app_pid and p == app_pid: return 'self'
    if is_game(w): return 'PathOfExile'
    c = wm_class(w).split(' ')
    return (c[-1] if c and c[-1] else '') or comm(p) or '?'

def active():
    v = prop(root, '_NET_ACTIVE_WINDOW')
    if v and v[0]: return v[0]
    w = Window(); r = c_int(); X.XGetInputFocus(d, byref(w), byref(r))
    return w.value if w.value > 1 else 0  # 0/1: None/PointerRoot

def pointer_window():
    # walk down from the root to the deepest window under the mouse; the first one with a class is the app's
    w = root; chain = []
    rr = Window(); ch = Window(); rx = c_int(); ry = c_int(); wx = c_int(); wy = c_int(); m = c_uint()
    for _ in range(8):
        if not X.XQueryPointer(d, w, byref(rr), byref(ch), byref(rx), byref(ry), byref(wx), byref(wy), byref(m)) or not ch.value: break
        w = ch.value; chain.append(w)
    for c in chain:
        if wm_class(c) or pid_of(c): return c
    return chain[-1] if chain else 0

def find_game():
    for w in (prop(root, '_NET_CLIENT_LIST') or []):
        if is_game(w): return w
    return 0

def activate(w):
    ev = XEvent(); e = ev.xclient
    e.type = 33; e.send_event = 1; e.display = d; e.window = w; e.format = 32
    e.message_type = X.XInternAtom(d, b'_NET_ACTIVE_WINDOW', 0)
    e.l[0] = 2; e.l[1] = 0; e.l[2] = 0  # 2: asked for by a tool on the user's behalf
    X.XSendEvent(d, root, 0, (1 << 20) | (1 << 19), byref(ev)); X.XFlush(d)

def key(code, down):
    T.XTestFakeKeyEvent(d, code, 1 if down else 0, 0); X.XFlush(d)

def held(code):
    km = (ctypes.c_char * 32)(); X.XQueryKeymap(d, km)
    return (ord(km[code // 8]) >> (code % 8)) & 1

MODS = set(KC(k) for k in (0xffe1, 0xffe2, 0xffe3, 0xffe4, 0xffe9, 0xffea, 0xffeb, 0xffec, 0xfe03))
def wait_hotkey_released(timeout=4.0):
    # X11 grabs the whole keyboard while the hotkey is held down: keys sent meanwhile go to this app,
    # not the game. Wait until only modifiers (or nothing) are down (a slow release of the hotkey is
    # normal, so give it a few seconds before giving up).
    end = time.time() + timeout
    while time.time() < end:
        km = (ctypes.c_char * 32)(); X.XQueryKeymap(d, km)
        down = [i * 8 + b for i in range(32) for b in range(8) if (ord(km[i]) >> b) & 1]
        if not [k for k in down if k not in MODS]: return True
        time.sleep(0.01)
    return False

def prepare(app_pid, nudge):
    extra = '' if wait_hotkey_released() else ';hotkey-held'
    time.sleep(0.03)  # the grab ends just after the release
    fg = active(); under = pointer_window()
    if nudge:
        T.XTestFakeRelativeMotionEvent(d, 1, 0, 0); X.XFlush(d); time.sleep(0.02)
        T.XTestFakeRelativeMotionEvent(d, -1, 0, 0); X.XFlush(d); extra += ';nudged'
    fg_name = describe(fg, app_pid); under_name = describe(under, app_pid)
    if fg_name != 'PathOfExile' and (fg_name == 'self' or under_name == 'PathOfExile'):
        game = under if under_name == 'PathOfExile' else find_game()
        if game:
            activate(game); time.sleep(0.12)
            if not is_game(active()):  # window manager ignored the request: set the focus ourselves
                X.XRaiseWindow(d, game); X.XSetInputFocus(d, game, 2, 0); X.XFlush(d); time.sleep(0.08)
            if is_game(active()): fg_name = 'PathOfExile'; extra += ';refocused'
            else: extra += ';refocus-failed'
        else: extra += ';refocus-failed'
    if nudge: time.sleep(0.07)
    now = active()
    g = which_game(now) if is_game(now) else (which_game(under) if under_name == 'PathOfExile' else '')
    if g: extra += ';game=' + g
    return 'fg=%s;over=%s%s' % (fg_name, under_name, extra)

def copy(advanced):
    for k in SHIFTS + ALTGR:                       # let go of Shift (either) and AltGr
        if held(k): key(k, False)
    alts = [k for k in ALTS if held(k)]
    alt = bool(alts)
    if alt and not advanced:                       # let go of Alt (from an Alt+ hotkey); advanced copy keeps it
        for k in alts: key(k, False)
    key(CTRL, True); time.sleep(0.015)
    if advanced and not alt: key(ALT, True); time.sleep(0.015)
    key(C, True); time.sleep(0.04); key(C, False); time.sleep(0.015)
    if advanced and not alt: key(ALT, False)
    key(CTRL, False)

out('ready')
for line in sys.stdin:
    parts = line.split()
    if not parts: continue
    try:
        app_pid = int(parts[1]) if len(parts) > 1 else 0
        target = prepare(app_pid, len(parts) > 2 and parts[2] == 'nudge')
        # only ever press Ctrl+C in the game: in another window it would copy (or, in a terminal, interrupt) something else
        # "?" (a window we can't name, e.g. no active window on some Wayland desktops) only counts when the mouse is over the game
        if target.startswith('fg=PathOfExile;') or target.startswith('fg=?;over=PathOfExile'): copy(parts[0] == 'advanced')
        else: target += ';skipped'
        out('ok ' + target)
    except Exception as e:
        out('err %s' % e)
`;

class KeySender {
  constructor(log, dir) {
    this.log = log || (() => {});
    this.dir = dir || os.tmpdir();
    this.proc = null;
    this.ready = false;
    this.waiters = [];
    this.supported = process.platform === 'win32' || process.platform === 'linux';
    // Windows: the prebuilt poekeys.exe when it's there (starts at once, no PowerShell), else PowerShell
    this.exe = process.platform === 'win32' ? KeySender.findExe() : null;
    this.mode = process.platform === 'linux' ? 'python' : (this.exe ? 'native' : 'powershell');
    this.unavailable = null; // why sending keys can't work here (Linux without Python/X11 and xdotool)
  }

  // poekeys.exe: next to Path of Building's host (resources/pob/runtime) in the installed app, or in vendor/ after a build from source
  static findExe() {
    const tries = [];
    if (process.resourcesPath) tries.push(path.join(process.resourcesPath, 'pob', 'runtime', 'poekeys.exe'));
    tries.push(path.join(__dirname, '..', 'vendor', 'pob', 'runtime', 'poekeys.exe'));
    return tries.find((p) => { try { return fs.statSync(p).isFile(); } catch (_) { return false; } }) || null;
  }

  start() {
    if (!this.supported || this.proc || this.mode === 'xdotool') return;
    try {
      if (this.mode === 'native') {
        this.proc = spawn(this.exe, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      } else if (this.mode === 'python') {
        const script = path.join(this.dir, 'poe2uc-keys.py');
        fs.writeFileSync(script, PY_SCRIPT);
        this.proc = spawn('python3', ['-u', script], { stdio: ['pipe', 'pipe', 'pipe'] });
      } else {
        const script = path.join(this.dir, 'poe2uc-keys.ps1');
        fs.writeFileSync(script, PS_SCRIPT);
        this.proc = spawn('powershell.exe',
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
          { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      }
    } catch (err) {
      this.log(`keysender: could not start ${this.mode}: ${err.message}`);
      this.proc = null;
      if (this.mode === 'python') this.fallbackLinux(err.message);
      return;
    }
    let buf = '';
    this.proc.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (line === 'ready') { this.ready = true; this.log(`keysender: ready (${this.mode})`); continue; }
        if (line.startsWith('fatal')) { this.log('keysender: ' + line); this.fatal = line.slice(6); continue; }
        const w = this.waiters.shift();
        if (line.startsWith('err')) this.log('keysender: ' + line);
        if (w) w(line.startsWith('ok') ? (line.slice(3) || 'game') : false);
      }
    });
    this.proc.stderr.on('data', (d) => this.log('keysender stderr: ' + d.toString().trim()));
    // PowerShell blocked (AppLocker, antivirus) or gone: log it instead of crashing, and start over next time
    this.proc.on('error', (err) => {
      this.log('keysender: ' + err.message);
      this.proc = null; this.ready = false;
      this.waiters.splice(0).forEach((w) => w(false));
      // poekeys.exe blocked (antivirus) or gone: use PowerShell from the next press on
      if (this.mode === 'native') { this.mode = 'powershell'; this.log('keysender: poekeys.exe would not start, using PowerShell'); }
      if (this.mode === 'python') { this.stopping = true; this.fallbackLinux(err.message); } // no python3
    });
    this.proc.stdin.on('error', (err) => this.log('keysender: ' + err.message));
    this.proc.on('exit', (code) => {
      this.log('keysender exited ' + code);
      const wasReady = this.ready;
      this.proc = null; this.ready = false;
      // poekeys.exe stopped before it was ready (blocked, or .NET missing): PowerShell from now on
      if (this.mode === 'native' && !wasReady && !this.stopping) { this.mode = 'powershell'; this.log('keysender: poekeys.exe stopped before it was ready, using PowerShell'); }
      this.waiters.splice(0).forEach((w) => w(false));
      // Linux: no X11/XTest (or no display): try xdotool instead of restarting a helper that can't work
      if (this.mode === 'python' && this.fatal) { this.fallbackLinux(this.fatal); return; }
      // start it again straight away, so it's ready for the next press (not while quitting)
      if (!this.stopping) { this.restarts = (this.restarts || 0) + 1; if (this.restarts < 20) setTimeout(() => { if (!this.proc && !this.stopping) this.start(); }, Math.min(30000, 500 * this.restarts)); }
    });
  }

  // Resolves once the keystroke was sent: to the name of the process it went to (truthy), or false.
  // opts.nudge: the popup was just hidden from under the mouse (see Prepare in the script)
  async copy(advanced, opts = {}) {
    if (!this.supported) return false;
    if (this.mode === 'xdotool') {
      return new Promise((resolve) => {
        // X11 grabs the keyboard while the hotkey is still held, so a key sent meanwhile goes to this
        // app, not the game: wait a moment for the hotkey to be let go (xdotool can't tell us when),
        // then send it with any held modifiers (Shift/Alt from the hotkey) cleared
        const p = spawn('xdotool', ['sleep', '0.35', 'key', '--clearmodifiers', advanced ? 'ctrl+alt+c' : 'ctrl+c'], { stdio: 'ignore' });
        p.on('error', () => resolve(false)); p.on('exit', (c) => resolve(c === 0 ? 'fg=?;over=?' : false));
      });
    }
    if (!this.proc) this.start();
    if (!this.proc) return false;
    // PowerShell compiles the helper on start (1–3 s): wait for it instead of dropping this press
    for (let t = 0; !this.ready && this.proc && t < 6000; t += 50) await new Promise((r) => setTimeout(r, 50));
    if (!this.ready || !this.proc) { this.log('keysender: not ready'); return false; }
    return new Promise((resolve) => {
      // Linux: the helper first waits (up to 4 s) for the hotkey to be let go
      // a timed-out press keeps its place in the queue: the helper answers every line in order, so its late
      // answer is the one that takes it off (and the next press still gets its own answer)
      const t = setTimeout(() => { this.log('keysender: no answer'); resolve(false); }, this.mode === 'python' ? 5500 : 2500);
      const w = (ok) => { clearTimeout(t); resolve(ok); };
      this.waiters.push(w);
      try { this.proc.stdin.write(`${advanced ? 'advanced' : 'copy'} ${process.pid}${opts.nudge ? ' nudge' : ''}\n`); } catch (_) {
        // never sent, so no answer will come: take it off the queue, or it would take the next press's answer
        const i = this.waiters.indexOf(w); if (i >= 0) this.waiters.splice(i, 1);
        w(false);
      }
    });
  }

  // Linux without Python's X11/XTest access: xdotool if it's installed, else nothing (you press
  // Ctrl+C yourself and the app reads the clipboard)
  fallbackLinux(why) {
    if (/ENOENT/.test(String(why))) why = "python3 isn't installed";
    try { require('child_process').execFileSync('xdotool', ['--version'], { stdio: 'ignore' }); this.mode = 'xdotool'; this.log('keysender: using xdotool (' + why + ')'); } catch (_) {
      this.mode = 'none'; this.supported = false;
      this.unavailable = `Can't send Ctrl+C to the game here (${why}). Press Ctrl+C on the item yourself – the app reads it from the clipboard – or install xdotool.`;
      this.log('keysender: ' + this.unavailable);
    }
  }

  stop() { this.stopping = true; if (this.proc) { try { this.proc.kill(); } catch (_) {} this.proc = null; } }
}

module.exports = { KeySender, PS_SCRIPT, PY_SCRIPT, CS_SOURCE, CS_MAIN };
