// RFP Manager.exe – starts RFP Manager (node server.js) without a console window, sits in the tray, and opens
// RFP Manager, Graphics control, the scorer, dashboards … in their own app windows (Microsoft Edge or Chrome in app
// mode, so no tabs or address bar). The console is still there: tray → Console.
// Built on this PC by tools\build-exe.ps1 (or "Build RFP Manager app.cmd") with the C# compiler that comes with Windows.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        bool first;
        using (Mutex m = new Mutex(true, "RFPManager.Launcher", out first))
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            if (!first) { Launcher.OpenWindow(Launcher.FindPort(AppDomain.CurrentDomain.BaseDirectory), "/"); return; }   // already running: just open a window
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
    bool quitting, opened;
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
        ExitThread();
    }

    // ------------------------------------------------------------------ windows
    static string Find(string[] paths) { foreach (string p in paths) { try { if (!string.IsNullOrEmpty(p) && File.Exists(p)) return p; } catch (Exception) { } } return null; }
    public static void OpenWindow(int port, string path)
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
        m.Items.Add(new ToolStripMenuItem("Open in my browser", null, delegate { try { Process.Start("http://localhost:" + port + "/"); } catch (Exception) { } }));
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
