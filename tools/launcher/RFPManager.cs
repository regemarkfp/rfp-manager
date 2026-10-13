// RFP Manager.exe – starts RFP Manager (node server.js) without a console window, sits in the tray, and shows
// RFP Manager, Graphics control, the scorer, dashboards … in its own windows (WebView2, the engine of Microsoft Edge,
// inside the exe: no browser, no tabs, no address bar). The console is still there: tray → Console.
// Built on this PC by tools\build-exe.ps1 (or "Build RFP Manager app.cmd") with the C# compiler that comes with Windows.
// The WebView2 parts (tools\launcher\webview2) are fetched once by the build; without them, or without the WebView2
// Runtime, windows open in Edge / Chrome app mode as before.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Pipes;
using System.Reflection;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;
#if WEBVIEW2
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System.Threading.Tasks;
#endif

static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        // the WebView2 assemblies live in tools\launcher\webview2, not next to the exe
        AppDomain.CurrentDomain.AssemblyResolve += delegate (object s, ResolveEventArgs e)
        {
            string name = new AssemblyName(e.Name).Name;
            string p = Path.Combine(Native.Folder, name + ".dll");
            return File.Exists(p) ? Assembly.LoadFrom(p) : null;
        };
        bool first;
        using (Mutex m = new Mutex(true, "RFPManager.Launcher", out first))
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            if (!first)
            {
                // already running: ask it to open a window (it owns the windows), else open one in the browser
                if (!Launcher.AskRunning(args.Length > 0 ? args[0] : "/")) Launcher.OpenInBrowserApp(Launcher.FindPort(AppDomain.CurrentDomain.BaseDirectory), "/");
                return;
            }
            Application.Run(new Launcher());
        }
    }
}

class Launcher : ApplicationContext
{
    readonly string dir = AppDomain.CurrentDomain.BaseDirectory;
    readonly int port;
    readonly NotifyIcon tray = new NotifyIcon();
    readonly ConsoleForm console;
    Process node;
    bool quitting, opened, native, toldTray;
    public static Launcher Current;
    const string PipeName = "RFPManager.Launcher.Open";
    int fastExits;
    DateTime started;
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";

    public Launcher()
    {
        port = FindPort(dir);
        console = new ConsoleForm(this);
        if (console.Handle == IntPtr.Zero) { }               // creates the window handle now, so lines can be added from other threads straight away
        Icon icon = null;
        try { icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception) { }
        tray.Icon = icon ?? SystemIcons.Application;
        console.Icon = tray.Icon;
        tray.Text = "RFP Manager";
        tray.ContextMenuStrip = BuildMenu();
        tray.DoubleClick += delegate { OpenWindow(port, "/"); };
        tray.Visible = true;
        Current = this;
        native = Native.Check(console);
        Thread pipe = new Thread(ListenForOtherCopies);
        pipe.IsBackground = true;
        pipe.Start();
        StartServer();
    }

    // ------------------------------------------------------------------ the server
    public static int FindPort(string dir)
    {
        try
        {
            string cfg = File.ReadAllText(Path.Combine(dir, "config.json"));
            Match m = Regex.Match(cfg, "\"port\"\\s*:\\s*(\\d+)");
            if (m.Success) return int.Parse(m.Groups[1].Value);
        }
        catch (Exception) { }
        return 8090;
    }
    string FindNode()
    {
        List<string> c = new List<string>();
        c.Add(Path.Combine(dir, "node\\node.exe"));                  // a node.exe kept next to RFP Manager (portable)
        foreach (string p in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
            if (p.Trim().Length > 0) c.Add(Path.Combine(p.Trim().Trim('"'), "node.exe"));
        c.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs\\node.exe"));
        c.Add(Path.Combine(Environment.GetEnvironmentVariable("ProgramFiles(x86)") ?? "", "nodejs\\node.exe"));
        c.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs\\nodejs\\node.exe"));
        foreach (string p in c) { try { if (File.Exists(p)) return p; } catch (Exception) { } }
        return null;
    }
    void StartServer()
    {
        string nodeExe = FindNode();
        if (nodeExe == null)
        {
            console.Append("Node.js was not found. Install the LTS version from https://nodejs.org and start RFP Manager again.");
            MessageBox.Show("RFP Manager needs Node.js.\n\nInstall the LTS version from https://nodejs.org, then start RFP Manager again.", "RFP Manager", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            try { Process.Start("https://nodejs.org"); } catch (Exception) { }
            tray.Visible = false;
            Environment.Exit(1);
            return;
        }
        if (!File.Exists(Path.Combine(dir, "server.js")))
        {
            MessageBox.Show("RFP Manager.exe must be in the RFP Manager folder (next to server.js).", "RFP Manager", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            tray.Visible = false;
            Environment.Exit(1);
            return;
        }
        ProcessStartInfo si = new ProcessStartInfo(nodeExe, "server.js");
        si.WorkingDirectory = dir;
        si.UseShellExecute = false;
        si.CreateNoWindow = true;
        si.RedirectStandardOutput = true;
        si.RedirectStandardError = true;
        si.RedirectStandardInput = true;
        si.StandardOutputEncoding = Encoding.UTF8;
        si.StandardErrorEncoding = Encoding.UTF8;
        si.EnvironmentVariables["RFP_LAUNCHER"] = "1";
        si.EnvironmentVariables["NO_COLOR"] = "1";
        node = new Process();
        node.StartInfo = si;
        node.EnableRaisingEvents = true;
        node.OutputDataReceived += delegate (object s, DataReceivedEventArgs e) { if (e.Data != null) Line(e.Data); };
        node.ErrorDataReceived += delegate (object s, DataReceivedEventArgs e) { if (e.Data != null) console.Append(e.Data); };
        node.Exited += delegate { console.BeginInvoke((MethodInvoker)delegate { ServerStopped(); }); };
        started = DateTime.Now;
        node.Start();
        node.BeginOutputReadLine();
        node.BeginErrorReadLine();
        Thread t = new Thread(WaitUntilUp);
        t.IsBackground = true;
        t.Start();
    }
    void Line(string s)
    {
        if (s.StartsWith("ACCOUNT ") || s == "ACCOUNTS-END") { console.Account(s); return; }
        console.Append(s);
    }
    void WaitUntilUp()
    {
        for (int i = 0; i < 120 && !quitting; i++)
        {
            try
            {
                HttpWebRequest r = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/healthz");
                r.Timeout = 1500;
                using (WebResponse resp = r.GetResponse()) { }
                console.BeginInvoke((MethodInvoker)delegate
                {
                    tray.Text = "RFP Manager – http://localhost:" + port;
                    if (!opened) { opened = true; OpenWindow(port, "/"); tray.ShowBalloonTip(3000, "RFP Manager is running", "Right-click the icon here for Graphics control, the scorer, dashboards and the console.", ToolTipIcon.Info); }
                });
                return;
            }
            catch (Exception) { Thread.Sleep(500); }
        }
    }
    void ServerStopped()
    {
        if (quitting) return;
        int code = 0;
        try { code = node.ExitCode; } catch (Exception) { }
        if (code == 75) { console.Append("RFP Manager was updated. Starting the new version…"); fastExits = 0; StartServer(); return; }
        console.Append("RFP Manager stopped (code " + code + ").");
        if ((DateTime.Now - started).TotalSeconds < 15) fastExits++; else fastExits = 0;
        if (fastExits >= 3) { console.Append("It keeps stopping: see the lines above. Fix it, then use Restart."); console.ShowConsole(); return; }
        console.Append("Starting it again in 3 seconds…");
        System.Windows.Forms.Timer t = new System.Windows.Forms.Timer();
        t.Interval = 3000;
        t.Tick += delegate { t.Stop(); t.Dispose(); if (!quitting) StartServer(); };
        t.Start();
    }
    public void Send(string line)
    {
        try { if (node != null && !node.HasExited) { node.StandardInput.WriteLine(line); node.StandardInput.Flush(); } }
        catch (Exception e) { console.Append("Could not send that: " + e.Message); }
    }
    public void Restart()
    {
        console.Append("Restarting RFP Manager…");
        fastExits = 0;
        if (node != null && !node.HasExited) { Send("q"); if (!node.WaitForExit(5000)) { try { node.Kill(); } catch (Exception) { } } }
        else StartServer();
    }
    public void Quit()
    {
        quitting = true;
        try
        {
            if (node != null && !node.HasExited)
            {
                Send("q");
                if (!node.WaitForExit(5000)) node.Kill();
            }
        }
        catch (Exception) { }
        tray.Visible = false;
        try { if (native) Native.CloseAll(); } catch (Exception) { }
        ExitThread();
    }

    // ------------------------------------------------------------------ windows
    static string Find(string[] paths) { foreach (string p in paths) { try { if (!string.IsNullOrEmpty(p) && File.Exists(p)) return p; } catch (Exception) { } } return null; }
    // A screen of RFP Manager in its own window: inside the exe (WebView2) when it can, else Edge / Chrome app mode.
    public static void OpenWindow(int port, string path)
    {
        Launcher l = Current;
        if (l != null && l.native)
        {
            if (l.console.InvokeRequired) { l.console.BeginInvoke((MethodInvoker)delegate { OpenWindow(port, path); }); return; }
            try { Native.Open("http://localhost:" + port + path); return; }
            catch (Exception e) { l.native = false; l.console.Append("Could not open the window inside RFP Manager (" + e.Message + "); using the browser instead."); }
        }
        OpenInBrowserApp(port, path);
    }
    public static void OpenInBrowserApp(int port, string path)
    {
        string url = "http://localhost:" + port + path;
        string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), pf86 = Environment.GetEnvironmentVariable("ProgramFiles(x86)") ?? "", local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string browser = Find(new string[] {
            Path.Combine(pf86, "Microsoft\\Edge\\Application\\msedge.exe"), Path.Combine(pf, "Microsoft\\Edge\\Application\\msedge.exe"),
            Path.Combine(pf, "Google\\Chrome\\Application\\chrome.exe"), Path.Combine(pf86, "Google\\Chrome\\Application\\chrome.exe"), Path.Combine(local, "Google\\Chrome\\Application\\chrome.exe") });
        try
        {
            if (browser == null) { Process.Start(url); return; }
            string profile = Path.Combine(local, "RFP Manager\\app-window");          // its own profile: stays signed in, its own taskbar group
            Process.Start(browser, "--app=\"" + url + "\" --user-data-dir=\"" + profile + "\" --no-first-run --no-default-browser-check --disable-features=Translate");
        }
        catch (Exception) { try { Process.Start(url); } catch (Exception) { } }
    }
    // a second RFP Manager.exe started: it asks this one (through a named pipe) to open a window
    public static bool AskRunning(string path)
    {
        try
        {
            using (NamedPipeClientStream c = new NamedPipeClientStream(".", PipeName, PipeDirection.Out))
            {
                c.Connect(1500);
                byte[] b = Encoding.UTF8.GetBytes(path.StartsWith("/") ? path : "/");
                c.Write(b, 0, b.Length);
                c.Flush();
            }
            return true;
        }
        catch (Exception) { return false; }
    }
    void ListenForOtherCopies()
    {
        while (!quitting)
        {
            try
            {
                using (NamedPipeServerStream srv = new NamedPipeServerStream(PipeName, PipeDirection.In, 1))
                {
                    srv.WaitForConnection();
                    byte[] buf = new byte[2048];
                    int n = srv.Read(buf, 0, buf.Length);
                    string path = n > 0 ? Encoding.UTF8.GetString(buf, 0, n) : "/";
                    if (!path.StartsWith("/")) path = "/";
                    OpenWindow(port, path);
                }
            }
            catch (Exception) { Thread.Sleep(1000); }
        }
    }
    // the last window was closed: RFP Manager keeps running in the tray (say so once)
    public void LastWindowClosed()
    {
        if (quitting || toldTray) return;
        toldTray = true;
        tray.ShowBalloonTip(4000, "RFP Manager is still running", "Graphics, scorers and outputs keep working. Double-click the icon here to open it again, or right-click → Quit.", ToolTipIcon.Info);
    }
    public void ShowConsole() { console.ShowConsole(); }

    ContextMenuStrip BuildMenu()
    {
        ContextMenuStrip m = new ContextMenuStrip();
        ToolStripMenuItem open = new ToolStripMenuItem("Open RFP Manager", null, delegate { OpenWindow(port, "/"); });
        open.Font = new Font(open.Font, FontStyle.Bold);
        m.Items.Add(open);
        m.Items.Add(new ToolStripSeparator());
        AddLink(m, "Graphics control", "/live/control.html");
        AddLink(m, "Scorer", "/scorer");
        AddLink(m, "Dashboards", "/live/dash.html");
        AddLink(m, "Timeline", "/live/timeline.html");
        AddLink(m, "Worship", "/live/worship.html");
        AddLink(m, "Monitors and screen links", "/#/monitors");
        m.Items.Add(new ToolStripSeparator());
        m.Items.Add(new ToolStripMenuItem("Console", null, delegate { console.ShowConsole(); }));
        m.Items.Add(new ToolStripMenuItem("Open in my web browser", null, delegate { try { Process.Start("http://localhost:" + port + "/"); } catch (Exception) { } }));
        m.Items.Add(new ToolStripMenuItem("Open the RFP Manager folder", null, delegate { try { Process.Start("explorer.exe", "\"" + dir + "\""); } catch (Exception) { } }));
        ToolStripMenuItem auto = new ToolStripMenuItem("Start with Windows");
        auto.Checked = StartsWithWindows();
        auto.Click += delegate { SetStartWithWindows(!auto.Checked); auto.Checked = StartsWithWindows(); };
        m.Items.Add(auto);
        m.Items.Add(new ToolStripSeparator());
        m.Items.Add(new ToolStripMenuItem("Restart RFP Manager", null, delegate { Restart(); }));
        m.Items.Add(new ToolStripMenuItem("Quit", null, delegate { Quit(); }));
        return m;
    }
    void AddLink(ContextMenuStrip m, string text, string path) { m.Items.Add(new ToolStripMenuItem(text, null, delegate { OpenWindow(port, path); })); }
    bool StartsWithWindows()
    {
        try { using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RunKey)) { return k != null && k.GetValue("RFP Manager") != null; } }
        catch (Exception) { return false; }
    }
    void SetStartWithWindows(bool on)
    {
        try
        {
            using (RegistryKey k = Registry.CurrentUser.CreateSubKey(RunKey))
            {
                if (on) k.SetValue("RFP Manager", "\"" + Application.ExecutablePath + "\"");
                else k.DeleteValue("RFP Manager", false);
            }
        }
        catch (Exception e) { MessageBox.Show("Could not change that: " + e.Message, "RFP Manager"); }
    }
    public int Port { get { return port; } }
    public Icon TrayIcon { get { return tray.Icon; } }
    public void Log(string line) { console.Append(line); }
}

// The console, as a window: what RFP Manager prints, and its keys as buttons
class ConsoleForm : Form
{
    readonly Launcher app;
    readonly RichTextBox box = new RichTextBox();
    readonly TextBox cmd = new TextBox();
    readonly List<string> accounts = new List<string>();
    bool wantAccounts;

    public ConsoleForm(Launcher a)
    {
        app = a;
        Text = "RFP Manager – console";
        Width = 980; Height = 620;
        StartPosition = FormStartPosition.CenterScreen;
        box.Dock = DockStyle.Fill;
        box.ReadOnly = true;
        box.BackColor = Color.FromArgb(22, 22, 22);
        box.ForeColor = Color.FromArgb(220, 220, 220);
        box.Font = new Font("Consolas", 10f);
        box.BorderStyle = BorderStyle.None;
        box.WordWrap = false;
        FlowLayoutPanel bar = new FlowLayoutPanel();
        bar.Dock = DockStyle.Bottom;
        bar.Height = 42;
        bar.Padding = new Padding(6);
        bar.BackColor = Color.FromArgb(38, 38, 38);
        AddButton(bar, "Open RFP Manager", delegate { Launcher.OpenWindow(app.Port, "/"); });
        AddButton(bar, "Status", delegate { app.Send("s"); });
        AddButton(bar, "Sync now", delegate { app.Send("y"); });
        AddButton(bar, "Reconnect CasparCG", delegate { app.Send("r"); });
        AddButton(bar, "Reset a password…", delegate { wantAccounts = true; accounts.Clear(); app.Send("accounts"); });
        AddButton(bar, "Restart", delegate { app.Restart(); });
        cmd.Width = 160;
        cmd.Margin = new Padding(12, 6, 3, 3);
        cmd.KeyDown += delegate (object s, KeyEventArgs e) { if (e.KeyCode == Keys.Enter) { app.Send(cmd.Text.Trim()); cmd.Clear(); e.SuppressKeyPress = true; } };
        bar.Controls.Add(cmd);
        Controls.Add(box);
        Controls.Add(bar);
    }
    void AddButton(FlowLayoutPanel bar, string text, EventHandler click)
    {
        Button b = new Button();
        b.Text = text;
        b.AutoSize = true;
        b.FlatStyle = FlatStyle.Flat;
        b.ForeColor = Color.White;
        b.BackColor = Color.FromArgb(55, 55, 55);
        b.Click += click;
        bar.Controls.Add(b);
    }
    public void ShowConsole() { Show(); WindowState = FormWindowState.Normal; Activate(); }
    public void Append(string line)
    {
        if (InvokeRequired) { BeginInvoke((MethodInvoker)delegate { Append(line); }); return; }
        if (box.Lines.Length > 4000) { box.Select(0, box.GetFirstCharIndexFromLine(1000)); box.ReadOnly = false; box.SelectedText = ""; box.ReadOnly = true; }
        box.AppendText(line + Environment.NewLine);
        box.SelectionStart = box.TextLength;
        box.ScrollToCaret();
    }
    public void Account(string line)
    {
        if (InvokeRequired) { BeginInvoke((MethodInvoker)delegate { Account(line); }); return; }
        if (line.StartsWith("ACCOUNT ")) { accounts.Add(line.Substring(8)); return; }
        if (!wantAccounts) return;
        wantAccounts = false;
        if (accounts.Count == 0) { Append("There are no accounts on this PC yet. Open RFP Manager to make the first one."); return; }
        using (PasswordDialog d = new PasswordDialog(accounts))
        {
            if (d.ShowDialog(this) == DialogResult.OK) app.Send("password " + d.Email + " " + d.Password);
        }
    }
    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); return; }      // closing the console keeps RFP Manager running
        base.OnFormClosing(e);
    }
}

class PasswordDialog : Form
{
    readonly ComboBox who = new ComboBox();
    readonly TextBox pw = new TextBox();
    public string Email { get { string s = who.SelectedItem == null ? "" : who.SelectedItem.ToString(); int i = s.IndexOf(' '); return i > 0 ? s.Substring(0, i) : s; } }
    public string Password { get { return pw.Text; } }
    public PasswordDialog(List<string> accounts)
    {
        Text = "New password (this PC)";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false; MinimizeBox = false;
        StartPosition = FormStartPosition.CenterParent;
        Width = 460; Height = 220;
        Label l1 = new Label(); l1.Text = "Account"; l1.Left = 14; l1.Top = 16; l1.AutoSize = true;
        who.Left = 120; who.Top = 12; who.Width = 300; who.DropDownStyle = ComboBoxStyle.DropDownList;
        foreach (string a in accounts) who.Items.Add(a);
        if (who.Items.Count > 0) who.SelectedIndex = 0;
        Label l2 = new Label(); l2.Text = "New password"; l2.Left = 14; l2.Top = 56; l2.AutoSize = true;
        pw.Left = 120; pw.Top = 52; pw.Width = 300;
        Label l3 = new Label(); l3.Text = "8 characters or more. For this PC only; the website signs in with Google."; l3.Left = 14; l3.Top = 88; l3.AutoSize = true;
        Button ok = new Button(); ok.Text = "Set password"; ok.Left = 230; ok.Top = 126; ok.Width = 110; ok.DialogResult = DialogResult.OK;
        Button cancel = new Button(); cancel.Text = "Cancel"; cancel.Left = 346; cancel.Top = 126; cancel.Width = 74; cancel.DialogResult = DialogResult.Cancel;
        AcceptButton = ok; CancelButton = cancel;
        Controls.AddRange(new Control[] { l1, who, l2, pw, l3, ok, cancel });
    }
}

// ---------------------------------------------------------------------------------------------- windows inside the exe
// Kept apart from Launcher, so a PC without the WebView2 parts still starts (the calls below fail and are caught).
// Built with /define:WEBVIEW2 when tools\launcher\webview2 has the WebView2 SDK; without it, only Edge / Chrome app mode.
#if !WEBVIEW2
static class Native
{
    public static string Folder { get { return Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "tools\\launcher\\webview2"); } }
    public static bool Check(ConsoleForm console) { console.Append("Windows open in Edge / Chrome: this RFP Manager.exe was built without WebView2 (run \"Build RFP Manager app.cmd\" with internet once)."); return false; }
    public static void Open(string url) { throw new NotSupportedException(); }
    public static void CloseAll() { }
}
#else
static class Native
{
    public static string Folder { get { return Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "tools\\launcher\\webview2"); } }
    static string Arch()
    {
        string a = (Environment.GetEnvironmentVariable("PROCESSOR_ARCHITECTURE") ?? "").ToUpperInvariant();
        return a == "ARM64" ? "arm64" : Environment.Is64BitProcess ? "x64" : "x86";
    }
    // true when windows can open inside RFP Manager
    public static bool Check(ConsoleForm console)
    {
        if (!File.Exists(Path.Combine(Folder, "Microsoft.Web.WebView2.WinForms.dll")))
        {
            console.Append("Windows open in Edge / Chrome: the WebView2 parts are not in tools\\launcher\\webview2 (run \"Build RFP Manager app.cmd\" with internet once).");
            return false;
        }
        try { string v = Version(); console.Append("Windows open inside RFP Manager (WebView2 " + v + ")."); return true; }
        catch (Exception e)
        {
            console.Append("Windows open in Edge / Chrome: the Microsoft Edge WebView2 Runtime was not found (" + e.GetType().Name + "). Install it from https://go.microsoft.com/fwlink/p/?LinkId=2124703 and restart RFP Manager.");
            return false;
        }
    }
    static string Version()
    {
        string loader = Path.Combine(Folder, Arch());
        if (Directory.Exists(loader)) { try { CoreWebView2Environment.SetLoaderDllFolderPath(loader); } catch (Exception) { } }
        return CoreWebView2Environment.GetAvailableBrowserVersionString();
    }
    public static void Open(string url) { AppWindow.Open(url); }
    public static void CloseAll() { AppWindow.CloseAll(); }
}

class AppWindow : Form
{
    static readonly List<AppWindow> all = new List<AppWindow>();
    static Task<CoreWebView2Environment> env;
    static readonly string dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RFP Manager");
    static readonly string placesFile = Path.Combine(dataDir, "windows.txt");
    readonly WebView2 web = new WebView2();
    readonly MenuStrip menu = new MenuStrip();
    readonly string startUrl;
    string place;                     // remembers size and position per screen (the first part of the address)
    bool fullScreen;
    FormWindowState before;
    FormBorderStyle beforeBorder;

    static Task<CoreWebView2Environment> Env()
    {
        if (env == null)
        {
            Directory.CreateDirectory(dataDir);
            CoreWebView2EnvironmentOptions o = new CoreWebView2EnvironmentOptions("--disable-features=Translate --autoplay-policy=no-user-gesture-required");
            env = CoreWebView2Environment.CreateAsync(null, Path.Combine(dataDir, "WebView2"), o);   // one profile: signed in once for every window
        }
        return env;
    }

    public static void Open(string url)
    {
        // the same screen already open: bring it forward instead of opening it twice
        string key = PlaceOf(url);
        foreach (AppWindow w in all)
            if (w.startUrl == url && !w.IsDisposed) { if (w.WindowState == FormWindowState.Minimized) w.WindowState = FormWindowState.Normal; w.Activate(); return; }
        AppWindow n = new AppWindow(url, key);
        n.Show();
    }
    public static void CloseAll() { foreach (AppWindow w in all.ToArray()) { try { w.Close(); } catch (Exception) { } } }

    AppWindow(string url, string key)
    {
        startUrl = url;
        place = key;
        all.Add(this);
        Text = "RFP Manager";
        Icon = Launcher.Current != null ? Launcher.Current.TrayIcon : null;
        BackColor = Color.FromArgb(23, 23, 23);
        StartPosition = FormStartPosition.Manual;
        Size = new Size(1360, 860);
        MinimumSize = new Size(360, 300);
        Rectangle wa = System.Windows.Forms.Screen.PrimaryScreen.WorkingArea;
        Location = new Point(wa.Left + Math.Max(0, (wa.Width - Width) / 2) + (all.Count - 1) * 28 % 200, wa.Top + Math.Max(0, (wa.Height - Height) / 2) + (all.Count - 1) * 28 % 200);
        Restore();
        web.Dock = DockStyle.Fill;
        web.DefaultBackgroundColor = Color.FromArgb(23, 23, 23);
        BuildMenu();
        Controls.Add(web);
        Controls.Add(menu);
        MainMenuStrip = menu;
        KeyPreview = true;
        Init(url);
    }

    async void Init(string url)
    {
        if (url == null) return;            // a window opened by a page: Attach() starts it
        try
        {
            CoreWebView2Environment e = await Env();
            await web.EnsureCoreWebView2Async(e);
        }
        catch (Exception ex)
        {
            if (Launcher.Current != null) Launcher.Current.Log("Window could not start: " + ex.Message);
            Launcher.OpenInBrowserApp(Port(), PathOf(url));
            Close();
            return;
        }
        Wire();
        web.CoreWebView2.Navigate(url);
    }
    void Wire()
    {
        CoreWebView2 cw = web.CoreWebView2;
        cw.Settings.IsStatusBarEnabled = false;
        cw.Settings.IsZoomControlEnabled = true;
        cw.DocumentTitleChanged += delegate { string t = cw.DocumentTitle; Text = string.IsNullOrEmpty(t) || t.StartsWith("http") || t == "about:blank" ? "RFP Manager" : t; };
        cw.NewWindowRequested += OnNewWindow;
        cw.ContainsFullScreenElementChanged += delegate { SetFullScreen(cw.ContainsFullScreenElement); };
        cw.WindowCloseRequested += delegate { Close(); };
        cw.SourceChanged += delegate { string k = PlaceOf(cw.Source); if (k != place && place != "popup") { Save(); place = k; } };
    }

    // window.open / target=_blank: RFP Manager's own screens open as new windows of the app (keeping the link
    // to the page that opened them, so reports and print previews work); anything else goes to the web browser.
    void OnNewWindow(object sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        string uri = e.Uri ?? "";
        if (!IsOurs(uri))
        {
            e.Handled = true;
            try { Process.Start(uri); } catch (Exception) { }
            return;
        }
        CoreWebView2Deferral d = e.GetDeferral();
        AppWindow w = new AppWindow(null, uri.StartsWith("http") ? PlaceOf(uri) : "popup");
        w.Show();
        w.Attach(e, d);
    }
    async void Attach(CoreWebView2NewWindowRequestedEventArgs e, CoreWebView2Deferral d)
    {
        try
        {
            CoreWebView2Environment en = await Env();
            await web.EnsureCoreWebView2Async(en);
            Wire();
            e.NewWindow = web.CoreWebView2;
            e.Handled = true;
        }
        catch (Exception) { }
        d.Complete();
    }
    static bool IsOurs(string uri)
    {
        if (uri == "" || uri.StartsWith("about:") || uri.StartsWith("blob:") || uri.StartsWith("data:")) return true;
        Uri u;
        if (!Uri.TryCreate(uri, UriKind.Absolute, out u)) return true;
        // Google sign-in opens a pop-up that must stay linked to the page that opened it
        if (string.Equals(u.Host, "accounts.google.com", StringComparison.OrdinalIgnoreCase)) return true;
        return u.IsLoopback || string.Equals(u.Host, "localhost", StringComparison.OrdinalIgnoreCase) || string.Equals(u.Host, Environment.MachineName, StringComparison.OrdinalIgnoreCase);
    }
    static string PathOf(string url) { Uri u; return url != null && Uri.TryCreate(url, UriKind.Absolute, out u) ? u.PathAndQuery + u.Fragment : "/"; }
    static string PlaceOf(string url)
    {
        if (url == null) return "popup";
        Uri u;
        if (!Uri.TryCreate(url, UriKind.Absolute, out u)) return "main";
        string p = u.AbsolutePath.Trim('/');
        if (p == "") return "main";
        if (p.StartsWith("live/")) p = p.Substring(5);
        int dot = p.IndexOf('.'); if (dot > 0) p = p.Substring(0, dot);
        return Regex.Replace(p, "[^A-Za-z0-9_-]", "_");
    }

    // ------------------------------------------------------------ menu
    void BuildMenu()
    {
        menu.Renderer = new ToolStripProfessionalRenderer(new DarkColors());
        menu.BackColor = Color.FromArgb(30, 30, 30);
        menu.ForeColor = Color.FromArgb(225, 225, 225);
        menu.Padding = new Padding(4, 1, 0, 1);
        ToolStripMenuItem app = Top("RFP Manager");
        Item(app, "Home", Keys.Alt | Keys.Home, delegate { Go("/"); });
        Item(app, "New window", Keys.Control | Keys.N, delegate { string u = web.Source != null ? web.Source.ToString() : "http://localhost:" + Port() + "/"; new AppWindow(u, PlaceOf(u)).Show(); });
        app.DropDownItems.Add(new ToolStripSeparator());
        Item(app, "Console", Keys.None, delegate { if (Launcher.Current != null) Launcher.Current.ShowConsole(); });
        Item(app, "Open this screen in my web browser", Keys.None, delegate { try { Process.Start(web.Source.ToString()); } catch (Exception) { } });
        app.DropDownItems.Add(new ToolStripSeparator());
        Item(app, "Close window", Keys.Control | Keys.W, delegate { Close(); });
        Item(app, "Quit RFP Manager", Keys.Control | Keys.Q, delegate { if (MessageBox.Show(this, "Quit RFP Manager? Graphics, scorers and outputs on other screens stop too.", "RFP Manager", MessageBoxButtons.OKCancel, MessageBoxIcon.Question) == DialogResult.OK && Launcher.Current != null) Launcher.Current.Quit(); });
        ToolStripMenuItem scr = Top("Screens");
        AddScreen(scr, "Graphics control", "/live/control.html", Keys.Control | Keys.D1);
        AddScreen(scr, "Scorer", "/scorer", Keys.Control | Keys.D2);
        AddScreen(scr, "Dashboards", "/live/dash.html", Keys.Control | Keys.D3);
        AddScreen(scr, "Timeline", "/live/timeline.html", Keys.Control | Keys.D4);
        AddScreen(scr, "Worship", "/live/worship.html", Keys.Control | Keys.D5);
        AddScreen(scr, "Rundown monitor", "/live/rundown.html", Keys.None);
        AddScreen(scr, "Browser output (preview of program)", "/output", Keys.None);
        scr.DropDownItems.Add(new ToolStripSeparator());
        AddScreen(scr, "Monitors and screen links", "/#/monitors", Keys.None);
        ToolStripMenuItem view = Top("View");
        Item(view, "Reload", Keys.F5, delegate { if (web.CoreWebView2 != null) web.CoreWebView2.Reload(); });
        Item(view, "Back", Keys.Alt | Keys.Left, delegate { if (web.CanGoBack) web.GoBack(); });
        view.DropDownItems.Add(new ToolStripSeparator());
        Item(view, "Zoom in", Keys.Control | Keys.Oemplus, delegate { web.ZoomFactor = Math.Min(3, web.ZoomFactor + 0.1); });
        Item(view, "Zoom out", Keys.Control | Keys.OemMinus, delegate { web.ZoomFactor = Math.Max(0.3, web.ZoomFactor - 0.1); });
        Item(view, "Actual size", Keys.Control | Keys.D0, delegate { web.ZoomFactor = 1; });
        view.DropDownItems.Add(new ToolStripSeparator());
        Item(view, "Full screen", Keys.F11, delegate { SetFullScreen(!fullScreen); });
        ToolStripMenuItem top = Item(view, "Always on top", Keys.None, null);
        top.Click += delegate { TopMost = !TopMost; top.Checked = TopMost; };
        Item(view, "Print…", Keys.Control | Keys.P, delegate { if (web.CoreWebView2 != null) web.CoreWebView2.ExecuteScriptAsync("window.print()"); });
        Item(view, "Developer tools", Keys.Control | Keys.Shift | Keys.I, delegate { if (web.CoreWebView2 != null) web.CoreWebView2.OpenDevToolsWindow(); });
    }
    ToolStripMenuItem Top(string text) { ToolStripMenuItem t = new ToolStripMenuItem(text); t.ForeColor = menu.ForeColor; menu.Items.Add(t); return t; }
    ToolStripMenuItem Item(ToolStripMenuItem parent, string text, Keys keys, EventHandler click)
    {
        ToolStripMenuItem i = new ToolStripMenuItem(text);
        i.ForeColor = Color.FromArgb(225, 225, 225);
        if (keys != Keys.None) { try { i.ShortcutKeys = keys; } catch (Exception) { i.ShortcutKeyDisplayString = keys.ToString(); } }
        if (click != null) i.Click += click;
        parent.DropDownItems.Add(i);
        return i;
    }
    void AddScreen(ToolStripMenuItem parent, string text, string path, Keys keys) { Item(parent, text, keys, delegate { Launcher.OpenWindow(Port(), path); }); }
    static int Port() { return Launcher.Current != null ? Launcher.Current.Port : 8090; }
    void Go(string path) { if (web.CoreWebView2 != null) web.CoreWebView2.Navigate("http://localhost:" + Port() + path); }

    // keys pressed while the page has focus reach the menu too (the WebView2 control passes unhandled shortcuts on)
    protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
    {
        if (keyData == Keys.Escape && fullScreen) { SetFullScreen(false); return true; }
        return base.ProcessCmdKey(ref msg, keyData);
    }

    void SetFullScreen(bool on)
    {
        if (on == fullScreen) return;
        fullScreen = on;
        if (on)
        {
            before = WindowState; beforeBorder = FormBorderStyle;
            menu.Visible = false;
            FormBorderStyle = FormBorderStyle.None;
            WindowState = FormWindowState.Normal;      // maximising a borderless window covers the taskbar
            WindowState = FormWindowState.Maximized;
        }
        else
        {
            FormBorderStyle = beforeBorder;
            WindowState = before;
            menu.Visible = true;
            if (web.CoreWebView2 != null && web.CoreWebView2.ContainsFullScreenElement) web.CoreWebView2.ExecuteScriptAsync("document.exitFullscreen && document.exitFullscreen()");
        }
    }

    // ------------------------------------------------------------ size and position per screen
    void Restore()
    {
        try
        {
            if (!File.Exists(placesFile)) return;
            foreach (string line in File.ReadAllLines(placesFile))
            {
                string[] p = line.Split('\t');
                if (p.Length < 6 || p[0] != place) continue;
                Rectangle r = new Rectangle(int.Parse(p[1]), int.Parse(p[2]), int.Parse(p[3]), int.Parse(p[4]));
                bool seen = false;
                foreach (System.Windows.Forms.Screen s in System.Windows.Forms.Screen.AllScreens) if (s.WorkingArea.IntersectsWith(r)) seen = true;
                if (!seen || r.Width < 300 || r.Height < 200) return;      // that monitor is gone
                Bounds = r;
                if (p[5] == "max") WindowState = FormWindowState.Maximized;
                return;
            }
        }
        catch (Exception) { }
    }
    void Save()
    {
        if (place == "popup" || fullScreen) return;
        try
        {
            Rectangle r = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            List<string> lines = new List<string>();
            if (File.Exists(placesFile)) foreach (string l in File.ReadAllLines(placesFile)) if (!l.StartsWith(place + "\t")) lines.Add(l);
            lines.Add(place + "\t" + r.X + "\t" + r.Y + "\t" + r.Width + "\t" + r.Height + "\t" + (WindowState == FormWindowState.Maximized ? "max" : "normal"));
            Directory.CreateDirectory(dataDir);
            File.WriteAllLines(placesFile, lines.ToArray());
        }
        catch (Exception) { }
    }
    protected override void OnFormClosing(FormClosingEventArgs e) { Save(); base.OnFormClosing(e); }
    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        all.Remove(this);
        try { web.Dispose(); } catch (Exception) { }
        base.OnFormClosed(e);
        if (all.Count == 0 && Launcher.Current != null) Launcher.Current.LastWindowClosed();
    }
}

class DarkColors : ProfessionalColorTable
{
    static readonly Color bg = Color.FromArgb(30, 30, 30), bg2 = Color.FromArgb(42, 42, 42), hi = Color.FromArgb(58, 58, 58), line = Color.FromArgb(64, 64, 64);
    public override Color MenuStripGradientBegin { get { return bg; } }
    public override Color MenuStripGradientEnd { get { return bg; } }
    public override Color ToolStripDropDownBackground { get { return bg2; } }
    public override Color ImageMarginGradientBegin { get { return bg2; } }
    public override Color ImageMarginGradientMiddle { get { return bg2; } }
    public override Color ImageMarginGradientEnd { get { return bg2; } }
    public override Color MenuItemSelected { get { return hi; } }
    public override Color MenuItemSelectedGradientBegin { get { return hi; } }
    public override Color MenuItemSelectedGradientEnd { get { return hi; } }
    public override Color MenuItemPressedGradientBegin { get { return bg2; } }
    public override Color MenuItemPressedGradientEnd { get { return bg2; } }
    public override Color MenuItemBorder { get { return line; } }
    public override Color MenuBorder { get { return line; } }
    public override Color SeparatorDark { get { return line; } }
    public override Color SeparatorLight { get { return line; } }
}
#endif
