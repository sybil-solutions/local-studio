// CRITICAL
import SwiftUI

struct ChatProcessingBar: View {
  let startedAt: Date
  let onTap: () -> Void
  @State private var isPulsing = false

  var body: some View {
    Button(action: onTap) {
      HStack(spacing: 10) {
        // Animated indicator
        HStack(spacing: 4) {
          ForEach(0..<3) { i in
            Circle()
              .fill(AppTheme.accentStrong)
              .frame(width: 6, height: 6)
              .opacity(isPulsing ? 1.0 : 0.4)
              .animation(
                .easeInOut(duration: 0.6)
                .repeatForever(autoreverses: true)
                .delay(Double(i) * 0.15),
                value: isPulsing
              )
          }
        }
        
        TimelineView(.periodic(from: startedAt, by: 1)) { context in
          let elapsed = Int(context.date.timeIntervalSince(startedAt))
          HStack(spacing: 4) {
            Text("Thinking")
              .font(AppTheme.captionFont.weight(.medium))
              .foregroundColor(AppTheme.foreground)
            Text("• \(elapsed)s")
              .font(AppTheme.captionFont)
              .foregroundColor(AppTheme.muted)
          }
        }
        
        Spacer()
        
        Image(systemName: "chevron.up")
          .font(.system(size: 12, weight: .medium))
          .foregroundColor(AppTheme.muted)
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 10)
      .background(AppTheme.accent.opacity(0.15))
      .cornerRadius(12)
      .overlay(
        RoundedRectangle(cornerRadius: 12)
          .stroke(AppTheme.accent.opacity(0.3), lineWidth: 1)
      )
    }
    .buttonStyle(.plain)
    .onAppear { isPulsing = true }
  }
}
