import SwiftUI

struct MarkdownText: View {
  let content: String

  var body: some View {
    let normalized = preserveLineBreaks(in: content)
    if let attributed = try? AttributedString(
      markdown: normalized,
      options: .init(interpretedSyntax: .full, failurePolicy: .returnPartiallyParsedIfPossible)
    ) {
      Text(attributed)
        .font(AppTheme.bodyFont)
    } else {
      Text(normalized)
        .font(AppTheme.bodyFont)
    }
  }

  private func preserveLineBreaks(in input: String) -> String {
    input.replacingOccurrences(of: "\r\n", with: "\n")
      .replacingOccurrences(of: "\n", with: "  \n")
  }
}
