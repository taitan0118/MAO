import UIKit
import WebKit

/// Một app, hai chế độ (giống bản Android): "server" = máy này là máy chủ của quán; "client" = kết nối máy chính có sẵn.
/// Giao diện là trang web của MAO; trang gọi window.maoDesktop để in, lưu file Excel, đổi chế độ.
final class MainViewController: UIViewController, WKScriptMessageHandler, WKUIDelegate {
    static let local = "http://127.0.0.1:3000"
    private let ud = UserDefaults.standard
    private var web: WKWebView!
    private var mode: String { ud.string(forKey: "mode") ?? "" }
    private var base: String { mode == "server" ? Self.local : (ud.string(forKey: "url") ?? "") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "MAO"
        let cfg = WKWebViewConfiguration()
        cfg.userContentController.add(self, name: "mao")
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        web = WKWebView(frame: view.bounds, configuration: cfg)
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        web.uiDelegate = self
        view.addSubview(web)
        route(ud.string(forKey: "page") ?? "/nhanvien")
    }

    /// Tạo window.maoDesktop cho trang (cùng tên với bản Windows, Mac, Android).
    private func inject() {
        let c = web.configuration.userContentController
        c.removeAllUserScripts()
        let saved = (try? String(data: JSONSerialization.data(withJSONObject: [ud.string(forKey: "url") ?? ""], options: []), encoding: .utf8)) ?? "[\"\"]"
        let js = """
        (function(){var p=function(k,a){webkit.messageHandlers.mao.postMessage({k:k,a:a||[]})};
        window.maoDesktop={printReceipt:function(){p('print')},notify:function(){},saveFile:function(n,b){p('save',[n,b])},
        chooseServer:function(){p('server')},connect:function(a,g){p('connect',[a,g])},retry:function(){p('retry')},reset:function(){p('reset')},
        savedAddress:function(){return \(saved)[0]}}})();
        """
        c.addUserScript(WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: false))
    }

    private func chon(_ q: String = "") {
        inject()
        let f = Bundle.main.url(forResource: "chon", withExtension: "html")!
        var u = URLComponents(url: f, resolvingAgainstBaseURL: false)!
        if !q.isEmpty { u.query = q }
        web.loadFileURL(u.url!, allowingReadAccessTo: f.deletingLastPathComponent())
    }

    private func route(_ page: String) {
        ud.set(page, forKey: "page")
        updateMenu()
        if mode.isEmpty { chon(); return }
        inject()
        UIApplication.shared.isIdleTimerDisabled = mode == "server" // máy chủ: không cho màn hình tự tắt
        if mode != "server" { web.load(URLRequest(url: URL(string: base + page)!)); return }
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("MAO/data").path
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        Node.start(dataDir: dir, ip: Node.lanIP())
        chon("dang-mo=1")
        DispatchQueue.global().async { // chờ máy chủ khởi động xong
            for _ in 0..<90 {
                let sem = DispatchSemaphore(value: 0); var ok = false
                URLSession.shared.dataTask(with: URLRequest(url: URL(string: Self.local + "/")!, timeoutInterval: 1)) { _, r, _ in
                    ok = (r as? HTTPURLResponse)?.statusCode == 200; sem.signal() }.resume()
                sem.wait()
                if ok { DispatchQueue.main.async { self.web.load(URLRequest(url: URL(string: Self.local + page)!)) }; return }
                Thread.sleep(forTimeInterval: 1)
            }
            DispatchQueue.main.async { self.chon("loi=may-chu") }
        }
    }

    private func updateMenu() {
        var items = [
            UIAction(title: "Máy quầy") { [unowned self] _ in self.route("/nhanvien") },
            UIAction(title: "Chủ quán") { [unowned self] _ in self.route("/chuquan") },
        ]
        if mode == "server" { items.append(UIAction(title: "Địa chỉ cho máy khác") { [unowned self] _ in self.showAddress() }) }
        items.append(UIAction(title: "Đổi chế độ / máy chủ", attributes: .destructive) { [unowned self] _ in self.changeMode() })
        navigationItem.rightBarButtonItem = UIBarButtonItem(image: UIImage(systemName: "ellipsis.circle"), menu: UIMenu(children: items))
    }

    private func alert(_ t: String, _ m: String, _ actions: [UIAlertAction] = []) {
        let a = UIAlertController(title: t, message: m, preferredStyle: .alert)
        (actions.isEmpty ? [UIAlertAction(title: "Đóng", style: .cancel)] : actions).forEach(a.addAction)
        present(a, animated: true)
    }

    private func showAddress() {
        let u = "http://\(Node.lanIP()):3000"
        alert("Địa chỉ cho máy khác", "Máy khác phải bắt cùng WiFi với máy này.\n\nMáy quầy: \(u)/nhanvien\nChủ quán: \(u)/chuquan\n\nGiữ MAO luôn mở trên màn hình, thoát ra là khách không gọi món được.")
    }

    private func changeMode() {
        if mode != "server" { ud.removeObject(forKey: "mode"); route("/nhanvien"); return }
        alert("Tắt máy chủ trên máy này?", "Khách sẽ không gọi món được cho tới khi bật lại. Dữ liệu vẫn được giữ. Sau khi tắt, mở lại MAO để chọn chế độ.", [
            UIAlertAction(title: "Không", style: .cancel),
            UIAlertAction(title: "Tắt máy chủ", style: .destructive) { [unowned self] _ in self.ud.removeObject(forKey: "mode"); self.ud.synchronize(); exit(0) },
        ])
    }

    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        guard let d = m.body as? [String: Any], let k = d["k"] as? String else { return }
        let a = d["a"] as? [String] ?? []
        switch k {
        case "print":
            let pi = UIPrintInfo(dictionary: nil); pi.outputType = .general; pi.jobName = "MAO hóa đơn"
            let pc = UIPrintInteractionController.shared
            pc.printInfo = pi; pc.printFormatter = web.viewPrintFormatter()
            pc.present(animated: true)
        case "save" where a.count == 2:
            let name = a[0].replacingOccurrences(of: "[\\\\/:*?\"<>|]", with: "_", options: .regularExpression)
            guard let data = Data(base64Encoded: a[1]) else { return }
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
            do { try data.write(to: url) } catch { alert("Không lưu được file", error.localizedDescription); return }
            let s = UIActivityViewController(activityItems: [url], applicationActivities: nil) // chọn "Lưu vào Tệp"
            s.popoverPresentationController?.barButtonItem = navigationItem.rightBarButtonItem
            present(s, animated: true)
        case "server": ud.set("server", forKey: "mode"); route("/nhanvien")
        case "connect" where a.count == 2:
            var u = a[0].trimmingCharacters(in: .whitespaces)
            if u.range(of: "^https?://", options: [.regularExpression, .caseInsensitive]) == nil { u = "http://" + u }
            while u.hasSuffix("/") { u.removeLast() }
            if u.range(of: ":\\d+$", options: .regularExpression) == nil { u += ":3000" }
            ud.set("client", forKey: "mode"); ud.set(u, forKey: "url")
            route(a[1] == "/chuquan" ? "/chuquan" : "/nhanvien")
        case "retry": route(ud.string(forKey: "page") ?? "/nhanvien")
        case "reset": changeMode()
        default: break
        }
    }

    // alert / confirm của trang web
    func webView(_ w: WKWebView, runJavaScriptAlertPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler done: @escaping () -> Void) {
        alert("MAO", m, [UIAlertAction(title: "OK", style: .default) { _ in done() }])
    }
    func webView(_ w: WKWebView, runJavaScriptConfirmPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler done: @escaping (Bool) -> Void) {
        alert("MAO", m, [UIAlertAction(title: "Huỷ", style: .cancel) { _ in done(false) }, UIAlertAction(title: "OK", style: .default) { _ in done(true) }])
    }
}
