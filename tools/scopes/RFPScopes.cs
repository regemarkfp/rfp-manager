// RFP Scopes.exe – a broadcast monitor with scopes, for Windows (its own release: tag scopes-v<version>).
// A big picture (NDI source on the network, or a capture card / camera) with waveform, vectorscope, phase and loudness
// below and audio meters beside it, safe areas, tally and a verdict before going live. The screen is the same page as
// RFP Manager's /scopes (public/scopes.html + public/js/scopes.js, copied into app\ by the build); this program adds
// what a browser cannot do: receiving NDI. Frames go to the page through a WebView2 shared buffer (no copy per frame),
// the sound as small messages. NDI comes from the NDI Runtime (installed with NDI Tools: https://ndi.video/tools/);
// without it, capture inputs still work. Built by tools\scopes\build.ps1 with the C# compiler that comes with Windows.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

static class Program
{
    public static readonly string Dir = AppDomain.CurrentDomain.BaseDirectory;
    public static readonly string Version = ReadVersion();
    static string ReadVersion() { try { return File.ReadAllText(Path.Combine(Dir, "VERSION")).Trim(); } catch (Exception) { return "1"; } }

    // what happened, for finding problems: %LOCALAPPDATA%\RFP Scopes\scopes.log (kept small)
    static readonly object logGate = new object();
    public static readonly string LogFile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RFP Scopes", "scopes.log");
    public static void Log(string text)
    {
        try
        {
            lock (logGate)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(LogFile));
                if (File.Exists(LogFile) && new FileInfo(LogFile).Length > 512 * 1024) File.Delete(LogFile);
                File.AppendAllText(LogFile, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + "  " + text + Environment.NewLine);
            }
        }
        catch (Exception) { }
    }

    [STAThread]
    static void Main()
    {
        Log("RFP Scopes " + Version + " starting (" + (Environment.Is64BitProcess ? "64-bit" : "32-bit") + ", " + Environment.OSVersion + ")");
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        string arch = (Environment.GetEnvironmentVariable("PROCESSOR_ARCHITECTURE") ?? "").ToUpperInvariant();
        string loader = Path.Combine(Dir, "webview2", arch == "ARM64" ? "arm64" : Environment.Is64BitProcess ? "x64" : "x86");
        if (Directory.Exists(loader)) { try { CoreWebView2Environment.SetLoaderDllFolderPath(loader); } catch (Exception) { } }
        try { CoreWebView2Environment.GetAvailableBrowserVersionString(); }
        catch (Exception)
        {
            if (MessageBox.Show("RFP Scopes needs the Microsoft Edge WebView2 Runtime (part of Windows 10 and 11). Download it now?", "RFP Scopes", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) == DialogResult.Yes)
                try { Process.Start("https://go.microsoft.com/fwlink/p/?LinkId=2124703"); } catch (Exception) { }
            return;
        }
        Ndi.Start();
        Log(Ndi.Ready ? "NDI ready: " + Ndi.Path : "NDI not ready: " + Ndi.Problem);
        ScopesWindow.Open();
        Application.Run(ScopesWindow.Context);
        Ndi.Stop();
    }
}

// ---------------------------------------------------------------- NDI (the NDI Runtime, Processing.NDI.Lib.x64.dll)
[StructLayout(LayoutKind.Sequential)] struct NdiSource { public IntPtr name; public IntPtr url; }
[StructLayout(LayoutKind.Sequential)] struct NdiFindCreate { [MarshalAs(UnmanagedType.U1)] public bool showLocal; public IntPtr groups; public IntPtr extraIps; }
[StructLayout(LayoutKind.Sequential)] struct NdiRecvCreate { public NdiSource source; public int colorFormat; public int bandwidth; [MarshalAs(UnmanagedType.U1)] public bool allowFields; public IntPtr recvName; }
[StructLayout(LayoutKind.Sequential)] struct NdiVideo { public int xres, yres; public uint fourCC; public int frN, frD; public float aspect; public int format; public long timecode; public IntPtr data; public int stride; public IntPtr metadata; public long timestamp; }
[StructLayout(LayoutKind.Sequential)] struct NdiAudio { public int sampleRate, channels, samples; public long timecode; public IntPtr data; public int channelStride; public IntPtr metadata; public long timestamp; }
[StructLayout(LayoutKind.Sequential)] struct NdiMeta { public int length; public long timecode; public IntPtr data; }
[StructLayout(LayoutKind.Sequential)] struct NdiTally { [MarshalAs(UnmanagedType.U1)] public bool program; [MarshalAs(UnmanagedType.U1)] public bool preview; }

static class Ndi
{
    const string Lib = "Processing.NDI.Lib.x64.dll";
    [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr LoadLibrary(string path);
    [DllImport("kernel32", EntryPoint = "RtlMoveMemory")] public static extern void Copy(IntPtr dst, IntPtr src, UIntPtr len);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] [return: MarshalAs(UnmanagedType.U1)] static extern bool NDIlib_initialize();
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] static extern void NDIlib_destroy();
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] static extern IntPtr NDIlib_find_create_v2(ref NdiFindCreate settings);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] static extern IntPtr NDIlib_find_get_current_sources(IntPtr find, out uint count);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] static extern void NDIlib_find_destroy(IntPtr find);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] public static extern IntPtr NDIlib_recv_create_v3(ref NdiRecvCreate settings);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] public static extern void NDIlib_recv_destroy(IntPtr recv);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] public static extern int NDIlib_recv_capture_v2(IntPtr recv, ref NdiVideo video, ref NdiAudio audio, ref NdiMeta meta, uint timeoutMs);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] public static extern void NDIlib_recv_free_video_v2(IntPtr recv, ref NdiVideo video);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] public static extern void NDIlib_recv_free_audio_v2(IntPtr recv, ref NdiAudio audio);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] public static extern void NDIlib_recv_free_metadata(IntPtr recv, ref NdiMeta meta);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] [return: MarshalAs(UnmanagedType.U1)] public static extern bool NDIlib_recv_set_tally(IntPtr recv, ref NdiTally tally);

    public static bool Ready;
    public static string Problem = "", Path = "";
    static IntPtr finder = IntPtr.Zero;
    static readonly object gate = new object();

    public static void Start()
    {
        try
        {
            string dll = null;
            foreach (string v in new[] { "NDI_RUNTIME_DIR_V6", "NDI_RUNTIME_DIR_V5", "NDI_RUNTIME_DIR_V4" })
            {
                string d = Environment.GetEnvironmentVariable(v);
                if (!string.IsNullOrEmpty(d) && File.Exists(System.IO.Path.Combine(d, Lib))) { dll = System.IO.Path.Combine(d, Lib); break; }
            }
            if (dll == null && File.Exists(System.IO.Path.Combine(Program.Dir, Lib))) dll = System.IO.Path.Combine(Program.Dir, Lib);
            if (dll == null) { Problem = "The NDI Runtime is not installed on this PC. Install NDI Tools (free) from ndi.video/tools, then start RFP Scopes again. Capture inputs work without it."; return; }
            Path = dll;
            if (LoadLibrary(dll) == IntPtr.Zero) { Problem = "The NDI Runtime could not be loaded (" + Marshal.GetLastWin32Error() + "). Reinstall NDI Tools."; return; }
            if (!NDIlib_initialize()) { Problem = "NDI does not start on this processor."; return; }
            NdiFindCreate fc = new NdiFindCreate(); fc.showLocal = true;
            finder = NDIlib_find_create_v2(ref fc);
            Ready = finder != IntPtr.Zero;
            if (!Ready) Problem = "NDI could not look for sources on the network.";
        }
        catch (Exception e) { Problem = "NDI: " + e.Message; Ready = false; }
    }
    public static void Stop() { try { if (finder != IntPtr.Zero) NDIlib_find_destroy(finder); if (Ready) NDIlib_destroy(); } catch (Exception) { } finder = IntPtr.Zero; }

    public static List<string> Sources()
    {
        List<string> list = new List<string>();
        if (!Ready) return list;
        lock (gate)
        {
            uint n;
            IntPtr p = NDIlib_find_get_current_sources(finder, out n);
            int size = Marshal.SizeOf(typeof(NdiSource));
            for (int i = 0; i < n; i++)
            {
                NdiSource s = (NdiSource)Marshal.PtrToStructure(IntPtr.Add(p, i * size), typeof(NdiSource));
                string name = Utf8(s.name);
                if (name != "") list.Add(name);
            }
        }
        list.Sort(StringComparer.OrdinalIgnoreCase);
        return list;
    }
    public static string Utf8(IntPtr p)
    {
        if (p == IntPtr.Zero) return "";
        int len = 0; while (Marshal.ReadByte(p, len) != 0) len++;
        byte[] b = new byte[len]; Marshal.Copy(p, b, 0, len);
        return Encoding.UTF8.GetString(b);
    }
    public static IntPtr Utf8Alloc(string s)
    {
        byte[] b = Encoding.UTF8.GetBytes(s ?? "");
        IntPtr p = Marshal.AllocHGlobal(b.Length + 1);
        Marshal.Copy(b, 0, p, b.Length); Marshal.WriteByte(p, b.Length, 0);
        return p;
    }
}

// one NDI source shown in one window: video into a shared buffer (the page answers "ack" when it has drawn it, so a
// slow screen skips frames instead of piling them up), sound as interleaved stereo Float32 (the chosen channel pair)
class NdiReceiver
{
    const uint RGBX = 'R' | ('G' << 8) | ('B' << 16) | ('X' << 24);
    readonly ScopesWindow win;
    readonly string name;
    readonly int bandwidth, pair;
    volatile bool running = true, waiting;
    long waitingSince;
    volatile int tallyWant = -1;
    CoreWebView2SharedBuffer buf;
    IntPtr bufPtr = IntPtr.Zero;
    int bufW, bufH;
    readonly Thread thread;

    public NdiReceiver(ScopesWindow w, string sourceName, int bw, int channelPair)
    {
        win = w; name = sourceName; bandwidth = bw; pair = Math.Max(0, channelPair);
        thread = new Thread(Run); thread.IsBackground = true; thread.Name = "NDI " + name;
        thread.Start();
    }
    public void Stop() { running = false; }
    int videoFrames, audioFrames, otherFrames, skipped;
    string lastFormat = "", lastAudio = "";
    int failures;
    void Status(string text) { win.Post("{\"ndi\":\"status\",\"text\":" + Js(text) + "}"); }
    void Fail(string what, Exception ex)
    {
        if (failures++ < 5) { Program.Log("NDI " + what + " failed: " + ex); win.Post("{\"ndi\":\"error\",\"text\":" + Js("The " + what + " from " + name + " could not be shown: " + ex.Message + " (details in " + Program.LogFile + ")") + "}"); }
    }
    public void Ack() { waiting = false; }
    public void Tally(bool program, bool preview) { tallyWant = (program ? 1 : 0) | (preview ? 2 : 0); }

    void Run()
    {
        IntPtr recv = IntPtr.Zero, nameMem = Ndi.Utf8Alloc(name), recvName = Ndi.Utf8Alloc("RFP Scopes");
        try
        {
            NdiRecvCreate rc = new NdiRecvCreate();
            rc.source.name = nameMem; rc.colorFormat = 2 /* RGBX_RGBA */; rc.bandwidth = bandwidth; rc.allowFields = false; rc.recvName = recvName;
            recv = Ndi.NDIlib_recv_create_v3(ref rc);
            Program.Log("NDI receiver for \"" + name + "\" (bandwidth " + bandwidth + ", channels " + (pair + 1) + "+" + (pair + 2) + "): " + (recv == IntPtr.Zero ? "FAILED" : "created"));
            if (recv == IntPtr.Zero) { win.Post("{\"ndi\":\"error\",\"text\":" + Js("Could not connect to " + name) + "}"); return; }
            Status("Connected to " + name + ": waiting for the first picture …");
            int lastNote = Environment.TickCount, started = Environment.TickCount;
            while (running)
            {
                if (Environment.TickCount - lastNote > 3000)
                {
                    lastNote = Environment.TickCount;
                    if (videoFrames == 0) Status((audioFrames > 0 ? "Sound is arriving from " : "Nothing has arrived yet from ") + name + " after " + (Environment.TickCount - started) / 1000 + " s (" + videoFrames + " pictures, " + audioFrames + " sound blocks, " + otherFrames + " other). Is the source sending, and is the network letting NDI through (firewall)?");
                    Program.Log("NDI \"" + name + "\": " + videoFrames + " video (" + lastFormat + "), " + audioFrames + " audio (" + lastAudio + "), " + skipped + " skipped, " + otherFrames + " other");
                }
                if (tallyWant >= 0) { NdiTally t = new NdiTally(); t.program = (tallyWant & 1) != 0; t.preview = (tallyWant & 2) != 0; tallyWant = -1; Ndi.NDIlib_recv_set_tally(recv, ref t); }
                NdiVideo v = new NdiVideo(); NdiAudio a = new NdiAudio(); NdiMeta m = new NdiMeta();
                int type = Ndi.NDIlib_recv_capture_v2(recv, ref v, ref a, ref m, 100);
                if (type == 1) { videoFrames++; try { Video(v); } catch (Exception ex) { Fail("picture", ex); } finally { Ndi.NDIlib_recv_free_video_v2(recv, ref v); } }
                else if (type == 2) { audioFrames++; try { Audio(a); } catch (Exception ex) { Fail("sound", ex); } finally { Ndi.NDIlib_recv_free_audio_v2(recv, ref a); } }
                else if (type == 3) { otherFrames++; Ndi.NDIlib_recv_free_metadata(recv, ref m); }
                else if (type == 4) { Program.Log("NDI \"" + name + "\": connection lost"); win.Post("{\"ndi\":\"error\",\"text\":" + Js("The NDI connection to " + name + " was lost") + "}"); Thread.Sleep(500); }
                else if (type == 100) otherFrames++;
            }
        }
        catch (Exception e) { Program.Log("NDI receiver stopped: " + e); win.Post("{\"ndi\":\"error\",\"text\":" + Js("NDI: " + e.Message) + "}"); }
        finally
        {
            try { if (recv != IntPtr.Zero) Ndi.NDIlib_recv_destroy(recv); } catch (Exception) { }
            Marshal.FreeHGlobal(nameMem); Marshal.FreeHGlobal(recvName);
            CoreWebView2SharedBuffer old = buf; buf = null;
            if (old != null) win.OnUi(delegate { try { old.Close(); } catch (Exception) { } });
        }
    }

    void Video(NdiVideo v)
    {
        if (v.data == IntPtr.Zero || v.xres <= 0 || v.yres <= 0) return;
        lastFormat = v.xres + "x" + v.yres + " " + FourCC(v.fourCC) + " stride " + v.stride + " " + v.frN + "/" + v.frD;
        if (waiting && Environment.TickCount - waitingSince < 1000) { skipped++; return; }       // the page is still drawing the last one
        if (buf == null || bufW != v.xres || bufH != v.yres)
        {
            int w = v.xres, h = v.yres;
            CoreWebView2SharedBuffer old = buf;
            CoreWebView2SharedBuffer nb = null;
            IntPtr np = IntPtr.Zero;
            Exception err = null;
            // a shared buffer may only be touched on the UI thread: make it, post it and read its address there
            win.OnUiWait(delegate
            {
                try { if (old != null) old.Close(); } catch (Exception) { }
                try { nb = win.NewBuffer(w, h); if (nb != null) np = nb.Buffer; } catch (Exception ex) { err = ex; }
            });
            if (nb == null) { buf = null; if (err != null) throw new Exception("the picture buffer could not be made (" + err.Message + "); update the Microsoft Edge WebView2 Runtime", err); return; }
            Program.Log("NDI \"" + name + "\": picture buffer " + w + "x" + h);
            buf = nb; bufPtr = np; bufW = w; bufH = h;
            if (bufPtr == IntPtr.Zero) throw new Exception("the picture buffer has no memory");
        }
        int row = v.xres * 4;
        if (v.stride == row) Ndi.Copy(bufPtr, v.data, (UIntPtr)(ulong)((long)row * v.yres));
        else for (int y = 0; y < v.yres; y++) Ndi.Copy(IntPtr.Add(bufPtr, y * row), IntPtr.Add(v.data, y * v.stride), (UIntPtr)(uint)row);
        if (v.fourCC == RGBX) Opaque(bufPtr, v.xres * v.yres);
        waiting = true; waitingSince = Environment.TickCount;
        win.Post("{\"ndi\":\"frame\",\"w\":" + v.xres + ",\"h\":" + v.yres + ",\"fpsN\":" + v.frN + ",\"fpsD\":" + v.frD + ",\"progressive\":" + (v.format == 1 ? "true" : "false") + "}");
    }
    // RGBX: the fourth byte is not alpha; the page draws RGBA, so it must be 255 (opaque)
    static unsafe void Opaque(IntPtr p, int pixels) { uint* q = (uint*)p.ToPointer(); for (int i = 0; i < pixels; i++) q[i] |= 0xFF000000u; }

    void Audio(NdiAudio a)
    {
        if (a.data == IntPtr.Zero || a.samples <= 0 || a.channels <= 0) return;
        int n = a.samples, c = a.channels;
        int l = Math.Min(pair, c - 1), r = Math.Min(pair + 1, c - 1);
        lastAudio = a.sampleRate + " Hz " + c + " ch " + n + " samples";
        float[] left = new float[n], right = new float[n], mix = new float[n * 2];
        Marshal.Copy(IntPtr.Add(a.data, l * a.channelStride), left, 0, n);
        Marshal.Copy(IntPtr.Add(a.data, r * a.channelStride), right, 0, n);
        for (int i = 0; i < n; i++) { mix[i * 2] = left[i]; mix[i * 2 + 1] = right[i]; }
        byte[] bytes = new byte[mix.Length * 4];
        Buffer.BlockCopy(mix, 0, bytes, 0, bytes.Length);
        win.Post("{\"ndi\":\"audio\",\"sr\":" + a.sampleRate + ",\"ch\":" + c + ",\"n\":" + n + ",\"d\":\"" + Convert.ToBase64String(bytes) + "\"}");
    }
    public static string Js(string s) { return new JavaScriptSerializer().Serialize(s ?? ""); }
    static string FourCC(uint f) { char[] c = new char[4]; for (int i = 0; i < 4; i++) { int b = (int)((f >> (8 * i)) & 0xFF); c[i] = b >= 32 && b < 127 ? (char)b : '?'; } return new string(c); }
}

// ---------------------------------------------------------------- the window
class ScopesWindow : Form
{
    public static readonly ApplicationContext Context = new ApplicationContext();
    static readonly List<ScopesWindow> all = new List<ScopesWindow>();
    static Task<CoreWebView2Environment> env;
    static readonly string dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RFP Scopes");
    readonly WebView2 web = new WebView2();
    readonly JavaScriptSerializer json = new JavaScriptSerializer();
    NdiReceiver rx;
    bool fullScreen;
    FormWindowState before;

    static Task<CoreWebView2Environment> Env()
    {
        if (env == null)
        {
            Directory.CreateDirectory(dataDir);
            CoreWebView2EnvironmentOptions o = new CoreWebView2EnvironmentOptions("--autoplay-policy=no-user-gesture-required --disable-features=Translate");
            env = CoreWebView2Environment.CreateAsync(null, Path.Combine(dataDir, "WebView2"), o);
        }
        return env;
    }
    public static void Open() { ScopesWindow w = new ScopesWindow(); w.Show(); }

    ScopesWindow()
    {
        all.Add(this);
        Text = "RFP Scopes " + Program.Version;
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception) { }
        BackColor = Color.FromArgb(11, 11, 11);
        Size = new Size(1500, 950);
        MinimumSize = new Size(640, 420);
        StartPosition = all.Count == 1 ? FormStartPosition.CenterScreen : FormStartPosition.WindowsDefaultLocation;
        KeyPreview = true;
        web.Dock = DockStyle.Fill;
        web.DefaultBackgroundColor = Color.FromArgb(11, 11, 11);
        Controls.Add(web);
        Init();
    }
    async void Init()
    {
        try { CoreWebView2Environment e = await Env(); await web.EnsureCoreWebView2Async(e); }
        catch (Exception ex) { MessageBox.Show(this, "RFP Scopes could not start its screen: " + ex.Message, "RFP Scopes"); Close(); return; }
        CoreWebView2 cw = web.CoreWebView2;
        cw.Settings.IsStatusBarEnabled = false;
        cw.Settings.AreDefaultContextMenusEnabled = false;
        cw.SetVirtualHostNameToFolderMapping("scopes.rfp", Path.Combine(Program.Dir, "app"), CoreWebView2HostResourceAccessKind.Allow);
        cw.PermissionRequested += delegate (object s, CoreWebView2PermissionRequestedEventArgs a)
        {
            if (a.PermissionKind == CoreWebView2PermissionKind.Camera || a.PermissionKind == CoreWebView2PermissionKind.Microphone ) a.State = CoreWebView2PermissionState.Allow;
        };
        cw.WebMessageReceived += OnMessage;
        cw.NavigationCompleted += delegate (object s, CoreWebView2NavigationCompletedEventArgs a) { Program.Log("Screen loaded: " + (a.IsSuccess ? "ok" : "failed " + a.WebErrorStatus) + " (WebView2 " + web.CoreWebView2.Environment.BrowserVersionString + ")"); };
        cw.ContainsFullScreenElementChanged += delegate { SetFullScreen(cw.ContainsFullScreenElement); };
        cw.NewWindowRequested += delegate (object s, CoreWebView2NewWindowRequestedEventArgs a) { a.Handled = true; try { Process.Start(a.Uri); } catch (Exception) { } };
        cw.Navigate("https://scopes.rfp/scopes.html?app=1&autostart=1");
    }

    // ------------------------------------------------------------ messages from the page
    void OnMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        Dictionary<string, object> m;
        try { m = json.Deserialize<Dictionary<string, object>>(e.WebMessageAsJson); } catch (Exception) { return; }
        string ndi = Str(m, "ndi"), app = Str(m, "app");
        if (ndi == "list")
        {
            if (!Ndi.Ready) { Post("{\"ndi\":\"sources\",\"list\":[]}"); if (!warned) { warned = true; Post("{\"ndi\":\"error\",\"text\":" + NdiReceiver.Js(Ndi.Problem) + "}"); } return; }
            Post("{\"ndi\":\"sources\",\"list\":" + json.Serialize(Ndi.Sources()) + "}");
        }
        else if (ndi == "open")
        {
            StopRx();
            if (!Ndi.Ready) { Post("{\"ndi\":\"error\",\"text\":" + NdiReceiver.Js(Ndi.Problem) + "}"); return; }
            string n = Str(m, "name");
            Program.Log("Open NDI source \"" + n + "\"");
            Text = "RFP Scopes · " + n;
            rx = new NdiReceiver(this, n, Int(m, "bandwidth", 100), Int(m, "pair", 0));
        }
        else if (ndi == "close") { StopRx(); Text = "RFP Scopes " + Program.Version; }
        else if (ndi == "ack") { if (rx != null) rx.Ack(); }
        else if (ndi == "tally") { if (rx != null) rx.Tally(Bool(m, "program"), Bool(m, "preview")); }
        else if (app == "newWindow") Open();
        else if (app == "get") Fetch(Int(m, "id", 0), Str(m, "url"));
    }
    bool warned;
    void StopRx() { if (rx != null) { rx.Stop(); rx = null; } }
    static string Str(Dictionary<string, object> m, string k) { object v; return m.TryGetValue(k, out v) && v != null ? Convert.ToString(v) : ""; }
    static int Int(Dictionary<string, object> m, string k, int d) { object v; if (!m.TryGetValue(k, out v) || v == null) return d; try { return Convert.ToInt32(v); } catch (Exception) { return d; } }
    static bool Bool(Dictionary<string, object> m, string k) { object v; return m.TryGetValue(k, out v) && v is bool && (bool)v; }

    // RFP Manager's values for the tally (another address: fetched here, the page cannot because of CORS)
    void Fetch(int id, string url)
    {
        if (!(url.StartsWith("http://") || url.StartsWith("https://"))) return;
        ThreadPool.QueueUserWorkItem(delegate
        {
            int status = 0; string body = "", error = "";
            try
            {
                HttpWebRequest r = (HttpWebRequest)WebRequest.Create(url);
                r.Timeout = 3000; r.ReadWriteTimeout = 3000; r.UserAgent = "RFP Scopes/" + Program.Version;
                using (HttpWebResponse res = (HttpWebResponse)r.GetResponse()) using (StreamReader sr = new StreamReader(res.GetResponseStream(), Encoding.UTF8)) { status = (int)res.StatusCode; body = sr.ReadToEnd(); }
            }
            catch (WebException we) { HttpWebResponse res = we.Response as HttpWebResponse; status = res != null ? (int)res.StatusCode : 0; error = we.Message; }
            catch (Exception ex) { error = ex.Message; }
            Post("{\"app\":\"got\",\"id\":" + id + ",\"status\":" + status + ",\"body\":" + NdiReceiver.Js(body) + ",\"error\":" + NdiReceiver.Js(error) + "}");
        });
    }

    // ------------------------------------------------------------ to the page (any thread)
    public void Post(string jsonText)
    {
        OnUi(delegate { try { if (web.CoreWebView2 != null) web.CoreWebView2.PostWebMessageAsJson(jsonText); } catch (Exception) { } });
    }
    public void OnUi(MethodInvoker f) { try { if (IsDisposed) return; if (InvokeRequired) BeginInvoke(f); else f(); } catch (Exception) { } }
    public void OnUiWait(MethodInvoker f) { try { if (IsDisposed) return; if (InvokeRequired) Invoke(f); else f(); } catch (Exception) { } }
    // a buffer for one picture, shared with the page (called on the UI thread)
    public CoreWebView2SharedBuffer NewBuffer(int w, int h)
    {
        if (web.CoreWebView2 == null) return null;
        CoreWebView2SharedBuffer b = web.CoreWebView2.Environment.CreateSharedBuffer((ulong)w * (ulong)h * 4);
        web.CoreWebView2.PostSharedBufferToScript(b, CoreWebView2SharedBufferAccess.ReadOnly, "{\"ndi\":\"buffer\",\"w\":" + w + ",\"h\":" + h + "}");
        return b;
    }

    // ------------------------------------------------------------ full screen (the page asks with requestFullscreen; F11 too)
    protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
    {
        if (keyData == Keys.F11) { SetFullScreen(!fullScreen); return true; }
        if (keyData == Keys.Escape && fullScreen) { SetFullScreen(false); return true; }
        if (keyData == (Keys.Control | Keys.N)) { Open(); return true; }
        return base.ProcessCmdKey(ref msg, keyData);
    }
    void SetFullScreen(bool on)
    {
        if (on == fullScreen) return;
        fullScreen = on;
        if (on) { before = WindowState; FormBorderStyle = FormBorderStyle.None; WindowState = FormWindowState.Normal; WindowState = FormWindowState.Maximized; }
        else
        {
            FormBorderStyle = FormBorderStyle.Sizable; WindowState = before;
            if (web.CoreWebView2 != null && web.CoreWebView2.ContainsFullScreenElement) web.CoreWebView2.ExecuteScriptAsync("document.exitFullscreen && document.exitFullscreen()");
        }
    }
    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        StopRx();
        all.Remove(this);
        try { web.Dispose(); } catch (Exception) { }
        base.OnFormClosed(e);
        if (all.Count == 0) Context.ExitThread();
    }
}
