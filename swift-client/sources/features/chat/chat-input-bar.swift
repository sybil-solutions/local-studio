import SwiftUI

struct ChatInputBar: View {
  @Binding var text: String
  let onSend: () -> Void

  var body: some View {
    HStack(spacing: 8) {
      TextField("Message", text: $text, axis: .vertical)
        .textFieldStyle(.roundedBorder)
      Button("Send", action: onSend)
        .buttonStyle(.borderedProminent)
        .tint(AppTheme.accentStrong)
    }
    .padding(8)
    .background(AppTheme.card)
  }
}
