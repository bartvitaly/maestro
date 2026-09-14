import UIKit
import WebKit

/// Thin WKWebView shell around the static Harbor Lease demo.
/// Not a Capacitor / App Store binary. Default URL is the Simulator loopback.
final class WebViewController: UIViewController, WKNavigationDelegate {
    static let defaultURL = "http://127.0.0.1:4173"

    private var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.websiteDataStore = .default()

        let web = WKWebView(frame: view.bounds, configuration: config)
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        web.navigationDelegate = self
        web.scrollView.contentInsetAdjustmentBehavior = .automatic
        if #available(iOS 16.4, *) {
            web.isInspectable = true
        }
        view.addSubview(web)
        webView = web

        if let url = URL(string: Self.resolveURL()) {
            web.load(URLRequest(url: url))
        }
    }

    static func resolveURL() -> String {
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "-url"), i + 1 < args.count {
            let value = args[i + 1]
            if !value.isEmpty { return value }
        }
        if let env = ProcessInfo.processInfo.environment["DEMO_URL"], !env.isEmpty {
            return env
        }
        return defaultURL
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        decisionHandler(.allow)
    }
}
