import Foundation
import Darwin

/// Chạy máy chủ MAO (Node.js) ngay trong app. Node chỉ khởi động được một lần mỗi lần mở app.
enum Node {
    private static var started = false

    static func start(dataDir: String, ip: String) {
        guard !started, let main = Bundle.main.path(forResource: "android-main", ofType: "js", inDirectory: "nodejs-project") else { return }
        started = true
        let args = ["node", main, dataDir, ip]
        // Node cần các tham số nằm liền nhau trong bộ nhớ
        let buf = calloc(args.reduce(0) { $0 + $1.utf8.count + 1 }, 1)!.assumingMemoryBound(to: CChar.self)
        var argv: [UnsafeMutablePointer<CChar>?] = []
        var p = buf
        for a in args { strcpy(p, a); argv.append(p); p += a.utf8.count + 1 }
        let t = Thread { _ = node_start(Int32(argv.count), &argv) }
        t.stackSize = 2 * 1024 * 1024
        t.start()
    }

    /// Địa chỉ WiFi của máy (en0), để khách quét mã QR vào được.
    static func lanIP() -> String {
        var ifa: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifa) == 0 else { return "" }
        defer { freeifaddrs(ifa) }
        var cur = ifa
        while let i = cur {
            let f = i.pointee
            if f.ifa_addr.pointee.sa_family == UInt8(AF_INET), String(cString: f.ifa_name) == "en0" {
                var h = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                getnameinfo(f.ifa_addr, socklen_t(f.ifa_addr.pointee.sa_len), &h, socklen_t(h.count), nil, 0, NI_NUMERICHOST)
                return String(cString: h)
            }
            cur = f.ifa_next
        }
        return ""
    }
}
