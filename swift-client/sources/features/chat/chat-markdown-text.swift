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
        .textSelection(.enabled)
    } else {
      Text(normalized)
        .textSelection(.enabled)
    }
  }

  private func preserveLineBreaks(in input: String) -> String {
    let normalized = input.replacingOccurrences(of: "\r\n", with: "\n")
    var output: [String] = []
    var inFence = false
    let lines = normalized.split(separator: "\n", omittingEmptySubsequences: false)
    for line in lines {
      let lineText = String(line)
      let trimmed = lineText.trimmingCharacters(in: .whitespaces)
      if trimmed.hasPrefix("```") {
        inFence.toggle()
        output.append(lineText)
        continue
      }
      if inFence || lineText.isEmpty {
        output.append(lineText)
      } else {
        output.append(lineText + "  ")
      }
    }
    return output.joined(separator: "\n")
  }
}
