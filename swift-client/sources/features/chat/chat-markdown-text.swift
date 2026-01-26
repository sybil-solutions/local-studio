import SwiftUI

struct MarkdownText: View {
  let content: String

  var body: some View {
    if let attributed = try? AttributedString(markdown: content) {
      Text(attributed)
    } else {
      Text(content)
    }
  }
}
