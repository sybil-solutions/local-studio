import SwiftUI

struct ChatProcessingBar: View {
  let startedAt: Date
  let onTap: () -> Void

  var body: some View {
    Button(action: onTap) {
      HStack(spacing: 8) {
        RoundedRectangle(cornerRadius: 2)
          .fill(AppTheme.error)
          .frame(width: 4, height: 16)
        TimelineView(.periodic(from: startedAt, by: 1)) { context in
          let elapsed = Int(context.date.timeIntervalSince(startedAt))
          Text("Model is thinking • \(elapsed)s")
            .font(AppTheme.captionFont)
            .foregroundColor(AppTheme.muted)
        }
        Spacer()
        Image(systemName: "chevron.up").font(.system(size: 10))
          .foregroundColor(AppTheme.muted)
      }
      .padding(8)
      .background(AppTheme.card)
      .cornerRadius(10)
    }
  }
}
