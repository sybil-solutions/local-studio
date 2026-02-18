// CRITICAL
import SwiftUI

#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

struct LogDetailView: View {
  let session: LogSession
  @EnvironmentObject private var container: AppContainer
  @StateObject private var model = LogDetailViewModel()
  @State private var showCopied = false

  var body: some View {
    VStack(spacing: 0) {
      header
      Divider().overlay(AppTheme.border)
      TextEditor(text: $model.content)
        .font(AppTheme.monoFont)
        .foregroundColor(AppTheme.foreground)
        .scrollContentBackground(.hidden)
        .padding(10)
        .background(AppTheme.background)
    }
    .background(AppTheme.background)
    .overlay(model.loading ? LoadingView("Loading logs…") : nil)
    .onAppear { model.connect(api: container.api, sessionId: session.id) }
    .onDisappear { model.stop() }
  }

  private var header: some View {
    HStack(spacing: 10) {
      VStack(alignment: .leading, spacing: 2) {
        Text(session.model ?? session.recipeName ?? "Log")
          .font(AppTheme.sectionFont)
          .foregroundColor(AppTheme.foreground)
          .lineLimit(1)
        Text(session.createdAt)
          .font(AppTheme.captionFont)
          .foregroundColor(AppTheme.muted)
      }
      Spacer()
      Button(action: copyToClipboard) {
        Text(showCopied ? "Copied" : "Copy")
          .font(AppTheme.captionFont.weight(.semibold))
          .foregroundColor(AppTheme.foreground)
          .padding(.horizontal, 10)
          .padding(.vertical, 8)
           .background(AppTheme.foreground.opacity(0.06))
          .clipShape(RoundedRectangle(cornerRadius: 10))
      }
      .buttonStyle(.plain)
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 10)
    .background(AppTheme.card)
  }

  private func copyToClipboard() {
    #if canImport(UIKit)
    UIPasteboard.general.string = model.content
    #endif
    showCopied = true
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { showCopied = false }
  }
}
