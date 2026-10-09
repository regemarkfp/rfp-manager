# RFP Manager - MIDI and X-keys on Windows, with nothing to install.
# RFP Manager starts this by itself when a MIDI or X-keys device is switched on in Settings -> Connections.
# It talks to Windows directly (winmm.dll for MIDI, hid.dll for X-keys) and to RFP Manager over stdin / stdout:
#   out:  {"t":"midi","port":"nanoPAD2","d":[144,60,100]}   {"t":"hid","id":"h1","d":[...]}   {"t":"ports",...}   {"t":"log","m":"..."}
#   in:   midi<TAB>port name part<TAB>144 60 100        hid<TAB>h1<TAB>0 181 5 1        list
# Try it by hand:  powershell -ExecutionPolicy Bypass -File rfp-hw.ps1     (then press keys / pads; Ctrl+C stops it)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$code = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;

public static class RfpHw
{
    // ------------------------------------------------------------------ output to RFP Manager (one JSON object per line)
    static readonly object outLock = new object();
    public static void Send(string json) { lock (outLock) { Console.Out.WriteLine(json); Console.Out.Flush(); } }
    public static string Esc(string s)
    {
        if (s == null) return "";
        StringBuilder sb = new StringBuilder();
        foreach (char c in s)
        {
            if (c == '"' || c == '\\') { sb.Append('\\'); sb.Append(c); }
            else if (c < 32) sb.Append(string.Format("\\u{0:x4}", (int)c));
            else sb.Append(c);
        }
        return sb.ToString();
    }
    static string Bytes(byte[] b, int from, int count)
    {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < count; i++) { if (i > 0) sb.Append(','); sb.Append(b[from + i]); }
        return sb.Append(']').ToString();
    }
    static void Log(string m) { Send("{\"t\":\"log\",\"m\":\"" + Esc(m) + "\"}"); }

    // ------------------------------------------------------------------ MIDI (winmm.dll)
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct MIDIINCAPS { public ushort wMid; public ushort wPid; public uint vDriverVersion; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szPname; public uint dwSupport; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct MIDIOUTCAPS { public ushort wMid; public ushort wPid; public uint vDriverVersion; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szPname; public ushort wTechnology; public ushort wVoices; public ushort wNotes; public ushort wChannelMask; public uint dwSupport; }
    delegate void MidiInProc(IntPtr hMidiIn, uint wMsg, IntPtr dwInstance, IntPtr dwParam1, IntPtr dwParam2);
    [DllImport("winmm.dll")] static extern uint midiInGetNumDevs();
    [DllImport("winmm.dll", CharSet = CharSet.Unicode, EntryPoint = "midiInGetDevCapsW")] static extern uint midiInGetDevCaps(UIntPtr id, ref MIDIINCAPS caps, uint size);
    [DllImport("winmm.dll")] static extern uint midiInOpen(out IntPtr h, uint id, MidiInProc cb, IntPtr instance, uint flags);
    [DllImport("winmm.dll")] static extern uint midiInStart(IntPtr h);
    [DllImport("winmm.dll")] static extern uint midiInStop(IntPtr h);
    [DllImport("winmm.dll")] static extern uint midiInClose(IntPtr h);
    [DllImport("winmm.dll")] static extern uint midiOutGetNumDevs();
    [DllImport("winmm.dll", CharSet = CharSet.Unicode, EntryPoint = "midiOutGetDevCapsW")] static extern uint midiOutGetDevCaps(UIntPtr id, ref MIDIOUTCAPS caps, uint size);
    [DllImport("winmm.dll")] static extern uint midiOutOpen(out IntPtr h, uint id, IntPtr cb, IntPtr instance, uint flags);
    [DllImport("winmm.dll")] static extern uint midiOutShortMsg(IntPtr h, uint msg);
    [DllImport("winmm.dll")] static extern uint midiOutClose(IntPtr h);
    const uint CALLBACK_FUNCTION = 0x30000, MIM_DATA = 0x3C3;

    static readonly MidiInProc midiProc = OnMidi;          // kept here so the garbage collector never frees it
    static readonly object midiLock = new object();
    static List<IntPtr> midiIns = new List<IntPtr>();
    static List<string> inNames = new List<string>();
    static Dictionary<string, IntPtr> midiOuts = new Dictionary<string, IntPtr>();
    static List<string> outNames = new List<string>();

    static List<string> InNames()
    {
        List<string> l = new List<string>();
        uint n = midiInGetNumDevs();
        for (uint i = 0; i < n; i++) { MIDIINCAPS c = new MIDIINCAPS(); if (midiInGetDevCaps(new UIntPtr(i), ref c, (uint)Marshal.SizeOf(typeof(MIDIINCAPS))) == 0) l.Add(c.szPname); else l.Add("MIDI in " + (i + 1)); }
        return l;
    }
    static List<string> OutNames()
    {
        List<string> l = new List<string>();
        uint n = midiOutGetNumDevs();
        for (uint i = 0; i < n; i++) { MIDIOUTCAPS c = new MIDIOUTCAPS(); if (midiOutGetDevCaps(new UIntPtr(i), ref c, (uint)Marshal.SizeOf(typeof(MIDIOUTCAPS))) == 0) l.Add(c.szPname); else l.Add("MIDI out " + (i + 1)); }
        return l;
    }
    static void OnMidi(IntPtr h, uint msg, IntPtr inst, IntPtr p1, IntPtr p2)
    {
        if (msg != MIM_DATA) return;
        try
        {
            uint m = (uint)(p1.ToInt64() & 0xFFFFFFFF);
            int idx = inst.ToInt32();
            string name = idx >= 0 && idx < inNames.Count ? inNames[idx] : "MIDI";
            Send("{\"t\":\"midi\",\"port\":\"" + Esc(name) + "\",\"d\":[" + (m & 0xFF) + "," + ((m >> 8) & 0xFF) + "," + ((m >> 16) & 0xFF) + "]}");
        }
        catch (Exception) { }
    }
    static bool ScanMidi()
    {
        lock (midiLock)
        {
            List<string> ins = InNames(), outs = OutNames();
            if (string.Join("\n", ins.ToArray()) == string.Join("\n", inNames.ToArray()) && string.Join("\n", outs.ToArray()) == string.Join("\n", outNames.ToArray())) return false;
            foreach (IntPtr h in midiIns) { midiInStop(h); midiInClose(h); }
            midiIns.Clear();
            foreach (IntPtr h in midiOuts.Values) midiOutClose(h);
            midiOuts.Clear();
            inNames = ins; outNames = outs;
            for (int i = 0; i < ins.Count; i++)
            {
                IntPtr h;
                uint r = midiInOpen(out h, (uint)i, midiProc, new IntPtr(i), CALLBACK_FUNCTION);
                if (r == 0) { midiInStart(h); midiIns.Add(h); }
                else Log("Could not open MIDI input " + ins[i] + " (error " + r + "; is another program using it?)");
            }
            return true;
        }
    }
    static void MidiOut(string filter, byte[] b)
    {
        lock (midiLock)
        {
            int sent = 0;
            for (int i = 0; i < outNames.Count; i++)
            {
                string name = outNames[i];
                if (filter.Length > 0 && name.IndexOf(filter, StringComparison.OrdinalIgnoreCase) < 0) continue;
                IntPtr h;
                if (!midiOuts.TryGetValue(name, out h))
                {
                    if (midiOutOpen(out h, (uint)i, IntPtr.Zero, IntPtr.Zero, 0) != 0) { Log("Could not open MIDI output " + name); continue; }
                    midiOuts[name] = h;
                }
                uint m = (uint)b[0] | ((uint)(b.Length > 1 ? b[1] : 0) << 8) | ((uint)(b.Length > 2 ? b[2] : 0) << 16);
                midiOutShortMsg(h, m);
                sent++;
            }
            if (sent == 0) Log("No MIDI output matches \"" + filter + "\"");
        }
    }

    // ------------------------------------------------------------------ X-keys (hid.dll, vendor 0x05F3)
    [DllImport("hid.dll")] static extern void HidD_GetHidGuid(out Guid g);
    [StructLayout(LayoutKind.Sequential)] struct SP_DEVICE_INTERFACE_DATA { public int cbSize; public Guid InterfaceClassGuid; public int Flags; public IntPtr Reserved; }
    [DllImport("setupapi.dll", SetLastError = true)] static extern IntPtr SetupDiGetClassDevs(ref Guid g, IntPtr enumerator, IntPtr hwnd, uint flags);
    [DllImport("setupapi.dll", SetLastError = true)] static extern bool SetupDiEnumDeviceInterfaces(IntPtr set, IntPtr devInfo, ref Guid g, uint index, ref SP_DEVICE_INTERFACE_DATA data);
    [DllImport("setupapi.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "SetupDiGetDeviceInterfaceDetailW")] static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr set, ref SP_DEVICE_INTERFACE_DATA data, IntPtr detail, int size, out int required, IntPtr devInfo);
    [DllImport("setupapi.dll")] static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "CreateFileW")] static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr sec, uint disp, uint flags, IntPtr tmpl);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool ReadFile(SafeFileHandle h, byte[] buf, int n, out int read, IntPtr ov);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool WriteFile(SafeFileHandle h, byte[] buf, int n, out int written, IntPtr ov);
    [StructLayout(LayoutKind.Sequential)] struct HIDD_ATTRIBUTES { public int Size; public ushort VendorID; public ushort ProductID; public ushort VersionNumber; }
    [StructLayout(LayoutKind.Sequential)]
    struct HIDP_CAPS
    {
        public ushort Usage; public ushort UsagePage; public ushort InputReportByteLength; public ushort OutputReportByteLength; public ushort FeatureReportByteLength;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 17)] public ushort[] Reserved;
        public ushort NumberLinkCollectionNodes; public ushort NumberInputButtonCaps; public ushort NumberInputValueCaps; public ushort NumberInputDataIndices;
        public ushort NumberOutputButtonCaps; public ushort NumberOutputValueCaps; public ushort NumberOutputDataIndices;
        public ushort NumberFeatureButtonCaps; public ushort NumberFeatureValueCaps; public ushort NumberFeatureDataIndices;
    }
    [DllImport("hid.dll")] static extern bool HidD_GetAttributes(SafeFileHandle h, ref HIDD_ATTRIBUTES a);
    [DllImport("hid.dll")] static extern bool HidD_GetPreparsedData(SafeFileHandle h, out IntPtr data);
    [DllImport("hid.dll")] static extern bool HidD_FreePreparsedData(IntPtr data);
    [DllImport("hid.dll")] static extern int HidP_GetCaps(IntPtr data, ref HIDP_CAPS caps);
    [DllImport("hid.dll", CharSet = CharSet.Unicode)] static extern bool HidD_GetProductString(SafeFileHandle h, StringBuilder buf, int bytes);
    [DllImport("hid.dll")] static extern bool HidD_SetOutputReport(SafeFileHandle h, byte[] buf, int n);
    const uint GENERIC_READ = 0x80000000, GENERIC_WRITE = 0x40000000, SHARE_RW = 3, OPEN_EXISTING = 3, DIGCF_PRESENT = 2, DIGCF_DEVICEINTERFACE = 0x10;

    class Hid { public string Id; public string Path; public string Name; public int Pid; public int InLen; public int OutLen; public SafeFileHandle Read; public SafeFileHandle Write; }
    static readonly object hidLock = new object();
    static Dictionary<string, Hid> hids = new Dictionary<string, Hid>();
    static int hidSeq = 0;

    static List<string> HidPaths()
    {
        List<string> l = new List<string>();
        Guid g; HidD_GetHidGuid(out g);
        IntPtr set = SetupDiGetClassDevs(ref g, IntPtr.Zero, IntPtr.Zero, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE);
        if (set == IntPtr.Zero || set == new IntPtr(-1)) return l;
        try
        {
            for (uint i = 0; i < 512; i++)
            {
                SP_DEVICE_INTERFACE_DATA d = new SP_DEVICE_INTERFACE_DATA();
                d.cbSize = Marshal.SizeOf(typeof(SP_DEVICE_INTERFACE_DATA));
                if (!SetupDiEnumDeviceInterfaces(set, IntPtr.Zero, ref g, i, ref d)) break;
                int need;
                SetupDiGetDeviceInterfaceDetail(set, ref d, IntPtr.Zero, 0, out need, IntPtr.Zero);
                if (need <= 0) continue;
                IntPtr buf = Marshal.AllocHGlobal(need);
                try
                {
                    Marshal.WriteInt32(buf, IntPtr.Size == 8 ? 8 : 6);
                    if (SetupDiGetDeviceInterfaceDetail(set, ref d, buf, need, out need, IntPtr.Zero))
                    {
                        string path = Marshal.PtrToStringUni(new IntPtr(buf.ToInt64() + 4));
                        if (path != null && path.IndexOf("vid_05f3", StringComparison.OrdinalIgnoreCase) >= 0) l.Add(path);
                    }
                }
                finally { Marshal.FreeHGlobal(buf); }
            }
        }
        finally { SetupDiDestroyDeviceInfoList(set); }
        return l;
    }
    static bool ScanHid()
    {
        bool changed = false;
        List<string> paths = HidPaths();
        lock (hidLock)
        {
            foreach (string p in paths)
            {
                bool known = false;
                foreach (Hid x in hids.Values) if (x.Path == p) known = true;
                if (known) continue;
                // the keyboard / mouse parts of an X-keys belong to Windows and cannot be opened; the data part can
                SafeFileHandle r = CreateFile(p, GENERIC_READ | GENERIC_WRITE, SHARE_RW, IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero);
                if (r.IsInvalid) continue;
                HIDP_CAPS caps = new HIDP_CAPS(); caps.Reserved = new ushort[17]; IntPtr pre;
                if (!HidD_GetPreparsedData(r, out pre)) { r.Close(); continue; }
                HidP_GetCaps(pre, ref caps); HidD_FreePreparsedData(pre);
                if (caps.InputReportByteLength < 8) { r.Close(); continue; }
                HIDD_ATTRIBUTES a = new HIDD_ATTRIBUTES(); a.Size = Marshal.SizeOf(typeof(HIDD_ATTRIBUTES)); HidD_GetAttributes(r, ref a);
                StringBuilder name = new StringBuilder(128); HidD_GetProductString(r, name, 256);
                SafeFileHandle w = CreateFile(p, GENERIC_WRITE, SHARE_RW, IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero);   // writes on their own handle, so a waiting read does not hold them up
                Hid x2 = new Hid();
                x2.Id = "h" + (++hidSeq); x2.Path = p; x2.Name = name.Length > 0 ? name.ToString() : "X-keys"; x2.Pid = a.ProductID; x2.InLen = caps.InputReportByteLength; x2.OutLen = caps.OutputReportByteLength; x2.Read = r; x2.Write = w;
                hids[x2.Id] = x2;
                Thread t = new Thread(ReadLoop); t.IsBackground = true; t.Start(x2);
                changed = true;
            }
        }
        return changed;
    }
    static void ReadLoop(object o)
    {
        Hid x = (Hid)o;
        byte[] buf = new byte[x.InLen];
        while (true)
        {
            int n;
            if (!ReadFile(x.Read, buf, buf.Length, out n, IntPtr.Zero) || n <= 0) break;
            // byte 0 is the report number; RFP Manager gets the report without it (as a browser would)
            if (n > 1) Send("{\"t\":\"hid\",\"id\":\"" + x.Id + "\",\"d\":" + Bytes(buf, 1, n - 1) + "}");
        }
        lock (hidLock) { hids.Remove(x.Id); }
        try { x.Read.Close(); if (x.Write != null) x.Write.Close(); } catch (Exception) { }
        SendPorts();
    }
    static void HidOut(string id, byte[] data)
    {
        Hid x;
        lock (hidLock) { if (!hids.TryGetValue(id, out x)) { Log("No X-keys " + id); return; } }
        int len = Math.Max(x.OutLen, data.Length);
        if (len <= 0) return;
        byte[] buf = new byte[len];
        Array.Copy(data, buf, Math.Min(data.Length, len));
        int written;
        bool ok = x.Write != null && !x.Write.IsInvalid && WriteFile(x.Write, buf, buf.Length, out written, IntPtr.Zero);
        if (!ok && !HidD_SetOutputReport(x.Read, buf, buf.Length)) Log("Could not write to " + x.Name + " (error " + Marshal.GetLastWin32Error() + ")");
    }

    // ------------------------------------------------------------------ the list of what is connected
    public static void SendPorts()
    {
        StringBuilder sb = new StringBuilder("{\"t\":\"ports\",\"midiIn\":[");
        lock (midiLock)
        {
            for (int i = 0; i < inNames.Count; i++) { if (i > 0) sb.Append(','); sb.Append('"').Append(Esc(inNames[i])).Append('"'); }
            sb.Append("],\"midiOut\":[");
            for (int i = 0; i < outNames.Count; i++) { if (i > 0) sb.Append(','); sb.Append('"').Append(Esc(outNames[i])).Append('"'); }
        }
        sb.Append("],\"hid\":[");
        lock (hidLock)
        {
            int k = 0;
            foreach (Hid x in hids.Values) { if (k++ > 0) sb.Append(','); sb.Append("{\"id\":\"" + x.Id + "\",\"name\":\"" + Esc(x.Name) + "\",\"pid\":" + x.Pid + ",\"in\":" + x.InLen + ",\"out\":" + x.OutLen + "}"); }
        }
        sb.Append("]}");
        Send(sb.ToString());
    }
    static Timer scanTimer;
    static int scanning = 0;
    static void Scan(object s)
    {
        if (Interlocked.Exchange(ref scanning, 1) == 1) return;     // the last scan is still going
        try { ScanBoth(); } finally { Interlocked.Exchange(ref scanning, 0); }
    }
    static void ScanBoth()
    {
        bool a = false, b = false;
        try { a = ScanMidi(); } catch (Exception e) { Log("MIDI: " + e.Message); }
        try { b = ScanHid(); } catch (Exception e) { Log("X-keys: " + e.Message); }
        if (a || b) SendPorts();
    }
    public static void Start()
    {
        Scan(null);
        SendPorts();
        scanTimer = new Timer(Scan, null, 3000, 3000);         // devices plugged in later are picked up
    }
    static byte[] ParseBytes(string s)
    {
        List<byte> l = new List<byte>();
        foreach (string p in s.Split(new char[] { ' ', ',' }, StringSplitOptions.RemoveEmptyEntries)) { int v; if (int.TryParse(p, out v)) l.Add((byte)(v & 0xFF)); }
        return l.ToArray();
    }
    public static void Command(string line)
    {
        if (line == null) return;
        string[] p = line.Split('\t');
        try
        {
            if (p[0] == "midi" && p.Length >= 3) MidiOut(p[1], ParseBytes(p[2]));
            else if (p[0] == "hid" && p.Length >= 3) HidOut(p[1], ParseBytes(p[2]));
            else if (p[0] == "list") SendPorts();
        }
        catch (Exception e) { Log(p[0] + ": " + e.Message); }
    }
}
'@
try {
  Add-Type -TypeDefinition $code -Language CSharp
} catch {
  [Console]::Out.WriteLine('{"t":"fatal","m":"' + ($_.Exception.Message -replace '\\', '\\' -replace '"', "'" -replace "[\r\n]+", ' ') + '"}')
  exit 2
}
[RfpHw]::Start()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  [RfpHw]::Command($line)
}
