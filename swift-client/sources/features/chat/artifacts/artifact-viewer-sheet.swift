import SwiftUI

struct ArtifactViewerSheet: View {
  let artifact: Artifact
  @State private var showCode = false
  @State private var copied = false
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      ZStack {
        AppTheme.background.ignoresSafeArea()
        if showCode {
          codeView
        } else {
          ArtifactWebView(htmlContent: ArtifactTemplates.render(artifact))
            .ignoresSafeArea(edges: .bottom)
        }
      }
      .navigationTitle(artifact.title.isEmpty ? artifact.type.label : artifact.title)
      .navigationBarTitleDisplayMode(.inline)
      .toolbarBackground(AppTheme.card, for: .navigationBar)
      .toolbarBackground(.visible, for: .navigationBar)
      .toolbar {
        ToolbarItem(placement: .topBarLeading) {
          Button("Done") { dismiss() }
            .foregroundColor(AppTheme.accentStrong)
        }
        ToolbarItem(placement: .topBarTrailing) {
          HStack(spacing: 12) {
            Button(action: { showCode.toggle() }) {
              Image(systemName: showCode ? "eye" : "chevron.left.forwardslash.chevron.right")
                .font(.system(size: 14))
            }
            .foregroundColor(AppTheme.foreground)

            Button(action: copyCode) {
              Image(systemName: copied ? "checkmark" : "doc.on.doc")
                .font(.system(size: 14))
            }
            .foregroundColor(copied ? AppTheme.success : AppTheme.foreground)

            ShareLink(item: artifact.code) {
              Image(systemName: "square.and.arrow.up")
                .font(.system(size: 14))
            }
            .foregroundColor(AppTheme.foreground)
          }
        }
      }
    }
  }

  private var codeView: some View {
    ScrollView {
      Text(artifact.code)
        .font(AppTheme.monoFont)
        .foregroundColor(AppTheme.foreground)
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .background(AppTheme.card)
  }

  private func copyCode() {
    UIPasteboard.general.string = artifact.code
    copied = true
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { copied = false }
  }
}
