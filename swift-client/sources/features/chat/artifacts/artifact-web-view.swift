import SwiftUI
import WebKit

struct ArtifactWebView: UIViewRepresentable {
  let htmlContent: String

  func makeUIView(context: Context) -> WKWebView {
    let config = WKWebViewConfiguration()
    config.allowsInlineMediaPlayback = true
    let webView = WKWebView(frame: .zero, configuration: config)
    webView.isOpaque = false
    webView.backgroundColor = UIColor(AppTheme.background)
    webView.scrollView.backgroundColor = UIColor(AppTheme.background)
    webView.loadHTMLString(htmlContent, baseURL: nil)
    return webView
  }

  func updateUIView(_ webView: WKWebView, context: Context) {
    webView.loadHTMLString(htmlContent, baseURL: nil)
  }
}
