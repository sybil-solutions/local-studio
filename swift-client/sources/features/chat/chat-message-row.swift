import SwiftUI

struct ChatMessageRow: View {
  let message: StoredMessage

  var body: some View {
    HStack(alignment: .top) {
      if message.role == "assistant" { Spacer() }
      VStack(alignment: .leading, spacing: 6) {
        Text(message.role.capitalized).font(.caption).foregroundColor(AppTheme.muted)
        Text(message.content ?? "").font(AppTheme.bodyFont)
        if let calls = message.toolCalls, !calls.isEmpty {
          Text("Tools: \(calls.map { $0.function.name }.joined(separator: ", "))")
            .font(.caption).foregroundColor(AppTheme.accentStrong)
        }
      }
      .padding(10)
      .background(message.role == "assistant" ? AppTheme.accent : AppTheme.card)
      .cornerRadius(12)
      if message.role == "user" { Spacer() }
    }
  }
}
